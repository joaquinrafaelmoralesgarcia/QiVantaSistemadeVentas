// Métricas de apertura de correos — pedido explícito del usuario el
// 2026-09-12: top 10 de títulos más abiertos por campaña, top 10 de
// "contenido" (familia de tono / oferta) más visualizado por campaña, y
// qué tipo de empresa/negocio abre más, cada semana.
//
// Depende de que scripts/sincronizar-aperturas.js ya haya corrido (trae
// aperturas/familiaAsunto reales de Smartlead) — este módulo solo agrega
// lo que ya está en Mongo, no llama a Smartlead directamente (por eso sí
// puede vivir en un endpoint de Vercel, a diferencia del script de
// sincronización).
const { getDb } = require("./_mongo");

const ORIGENES_LATAM = ["apollo_latam", "hunter_latam", "clay_latam", "snov_latam", "lusha_latam", "kaspr_latam", "importacion_manual", "smartlead_existente"];

function bucketEmpleados(n) {
  if (n == null) return "desconocido";
  if (n < 100) return "< 100 empleados";
  if (n < 500) return "100-499 empleados";
  if (n < 1000) return "500-999 empleados";
  return "1000+ empleados";
}

async function topAsuntos(coleccion, filtroOrigen) {
  return coleccion
    .aggregate([
      { $match: { ...filtroOrigen, aperturas: { $exists: true }, asuntoEmail: { $ne: "" } } },
      { $group: { _id: "$asuntoEmail", aperturas: { $sum: "$aperturas" }, envios: { $sum: 1 }, familia: { $first: "$familiaAsunto" } } },
      { $sort: { aperturas: -1 } },
      { $limit: 10 },
      { $project: { _id: 0, asunto: "$_id", aperturas: 1, envios: 1, familia: 1 } },
    ])
    .toArray();
}

async function topFamilias(coleccion, filtroOrigen) {
  return coleccion
    .aggregate([
      { $match: { ...filtroOrigen, aperturas: { $exists: true }, familiaAsunto: { $exists: true, $ne: "sin_clasificar" } } },
      {
        $group: {
          _id: "$familiaAsunto",
          aperturas: { $sum: "$aperturas" },
          envios: { $sum: 1 },
          // Respuestas reales (pedido explícito del usuario el
          // 2026-09-13, complemento a aperturas — que se pueden inflar
          // por Apple Mail Privacy Protection / escaneo de seguridad).
          // "contestada" ya excluye rebotes (categoría 9 de Smartlead).
          respuestas: { $sum: { $cond: ["$contestada", 1, 0] } },
        },
      },
      {
        $addFields: {
          tasaAperturaPorEnvio: { $round: [{ $divide: ["$aperturas", "$envios"] }, 2] },
          tasaRespuestaPorEnvio: { $round: [{ $divide: ["$respuestas", "$envios"] }, 3] },
        },
      },
      { $sort: { aperturas: -1 } },
      { $limit: 10 },
      { $project: { _id: 0, familia: "$_id", aperturas: 1, envios: 1, respuestas: 1, tasaAperturaPorEnvio: 1, tasaRespuestaPorEnvio: 1 } },
    ])
    .toArray();
}

async function topOfertas(coleccion, filtroOrigen) {
  return coleccion
    .aggregate([
      { $match: { ...filtroOrigen, aperturas: { $exists: true }, oferta: { $exists: true, $ne: "" } } },
      { $group: { _id: "$oferta", aperturas: { $sum: "$aperturas" }, envios: { $sum: 1 } } },
      { $addFields: { tasaAperturaPorEnvio: { $round: [{ $divide: ["$aperturas", "$envios"] }, 2] } } },
      { $sort: { aperturas: -1 } },
      { $limit: 10 },
      { $project: { _id: 0, oferta: "$_id", aperturas: 1, envios: 1, tasaAperturaPorEnvio: 1 } },
    ])
    .toArray();
}

async function topTipoNegocioGoogleMaps(coleccion) {
  return coleccion
    .aggregate([
      { $match: { origenBusqueda: { $exists: true }, aperturas: { $exists: true }, categoria: { $ne: "" } } },
      { $group: { _id: "$categoria", aperturas: { $sum: "$aperturas" }, envios: { $sum: 1 } } },
      { $addFields: { tasaAperturaPorEnvio: { $round: [{ $divide: ["$aperturas", "$envios"] }, 2] } } },
      { $sort: { aperturas: -1 } },
      { $limit: 10 },
      { $project: { _id: 0, tipoNegocio: "$_id", aperturas: 1, envios: 1, tasaAperturaPorEnvio: 1 } },
    ])
    .toArray();
}

async function topTamanoEmpresaLatam(coleccion) {
  const leads = await coleccion
    .find({ origen: { $in: ORIGENES_LATAM }, aperturas: { $exists: true } })
    .project({ numEmpleados: 1, aperturas: 1 })
    .toArray();

  const porBucket = new Map();
  for (const l of leads) {
    const b = bucketEmpleados(l.numEmpleados);
    const actual = porBucket.get(b) || { aperturas: 0, envios: 0 };
    actual.aperturas += l.aperturas || 0;
    actual.envios += 1;
    porBucket.set(b, actual);
  }

  return Array.from(porBucket.entries())
    .map(([tamano, v]) => ({ tamanoEmpresa: tamano, aperturas: v.aperturas, envios: v.envios, tasaAperturaPorEnvio: Math.round((v.aperturas / v.envios) * 100) / 100 }))
    .sort((a, b) => b.aperturas - a.aperturas);
}

async function obtenerMetricasAperturas() {
  const db = await getDb();
  const coleccion = db.collection("leads");

  const filtroLatam = { origen: { $in: ORIGENES_LATAM } };
  const filtroGM = { origenBusqueda: { $exists: true } };

  const [
    asuntosLatam,
    asuntosGM,
    familiasLatam,
    familiasGM,
    ofertasLatam,
    tipoNegocioGM,
    tamanoLatam,
    totalSincronizadosLatam,
    totalSincronizadosGM,
  ] = await Promise.all([
    topAsuntos(coleccion, filtroLatam),
    topAsuntos(coleccion, filtroGM),
    topFamilias(coleccion, filtroLatam),
    topFamilias(coleccion, filtroGM),
    topOfertas(coleccion, filtroLatam),
    topTipoNegocioGoogleMaps(coleccion),
    topTamanoEmpresaLatam(coleccion),
    coleccion.countDocuments({ ...filtroLatam, aperturas: { $exists: true } }),
    coleccion.countDocuments({ ...filtroGM, aperturas: { $exists: true } }),
  ]);

  return {
    generadoEn: new Date(),
    totalSincronizados: { latam: totalSincronizadosLatam, googleMaps: totalSincronizadosGM },
    topAsuntos: { latam: asuntosLatam, googleMaps: asuntosGM },
    topFamiliasDeAsunto: { latam: familiasLatam, googleMaps: familiasGM },
    topOfertasLatam: ofertasLatam,
    topTipoNegocioGoogleMaps: tipoNegocioGM,
    topTamanoEmpresaLatam: tamanoLatam,
  };
}

module.exports = { obtenerMetricasAperturas };

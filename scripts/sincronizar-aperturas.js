// Sincroniza aperturas reales por lead (Smartlead) + clasifica la familia
// de cada asunto — pedido explícito del usuario el 2026-09-12: "quiero
// que hagas un apartado en mongodb y recopilemos cuales son los mensajes
// que mas se han abierto... empecemos con todos los que hemos enviado".
//
// Por qué corre aquí y no en /api: 1,161+ leads a sincronizar, cada uno
// necesita 1 llamada a Smartlead (message-history) — muy por encima de
// los 60s que da una función de Vercel Hobby. GitHub Actions no tiene ese
// límite, así que este script se ejecuta directo ahí (ver
// .github/workflows/sincronizar-metricas.yml) en vez de ser un endpoint.
//
// Hallazgo real al probar esto el 2026-09-12: muchos leads con
// emailEstado:"enviado_a_campana" en Mongo siguen con status:"STARTED"
// en Smartlead — eso solo significa "se agregó a la campaña", NO que
// Smartlead ya haya disparado el primer correo (eso depende del cupo
// diario de la campaña). Contar "0 aperturas" para esos sería engañoso
// (no es que no lo abrieron, es que ni se ha mandado). Por eso primero se
// trae el estado real de TODA la campaña de una sola vez
// (obtenerEstadosDeCampania, ya construido para el reciclaje) y solo se
// sincronizan aperturas de leads con status distinto de STARTED — de
// paso ahorra la mitad de las llamadas, porque ya trae el leadId sin
// necesitar el lookup global por correo.
//
// Guarda en cada documento de "leads": aperturas (open_count real,
// null si aún no se ha enviado), familiaAsunto (clasificado por IA en
// lotes de 20), y aperturasSincronizadoEn.
const fs = require("fs");
const path = require("path");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const { getDb } = require("../api/_mongo");
const { chatCompletionJSON } = require("../api/_deepinfraClient");
const { obtenerEstadosDeCampania } = require("../api/_smartlead");

const ORIGENES_LATAM = ["apollo_latam", "hunter_latam", "clay_latam", "snov_latam", "lusha_latam", "kaspr_latam", "importacion_manual"];
const SMARTLEAD_API_KEY = process.env.SMARTLEAD_API_KEY;
const SMARTLEAD_BASE = "https://server.smartlead.ai/api/v1";

const FAMILIAS = {
  1: "ahorro_directo",
  2: "comparacion_competencia",
  3: "cierre_interes_consultivo",
  4: "directa_comercial",
  5: "venta_consultiva",
  6: "duplicar_clientes",
};

async function obtenerAperturasReales(campaignId, leadId) {
  const histRes = await fetch(`${SMARTLEAD_BASE}/campaigns/${campaignId}/leads/${leadId}/message-history?api_key=${SMARTLEAD_API_KEY}`);
  if (!histRes.ok) return null;
  const hist = await histRes.json();
  const enviado = (hist.history || []).find((h) => h.type === "SENT");
  if (!enviado) return null;
  return { aperturas: Number(enviado.open_count || 0), subject: enviado.subject || null };
}

async function clasificarLoteDeAsuntos(asuntos) {
  const listaTexto = asuntos.map((a, i) => `${i + 1}. "${a}"`).join("\n");
  const prompt = `Clasifica cada asunto de correo de ventas en UNA de estas 6 familias por su ID numérico:
1 ahorro_directo (habla de gastar menos, reducir costo operativo)
2 comparacion_competencia (menciona a la competencia)
3 cierre_interes_consultivo (invita a descubrir dónde se pierde dinero, tono de propuesta)
4 directa_comercial (golpe corto de impacto, urgencia)
5 venta_consultiva (tono suave, detectar/recuperar dinero)
6 duplicar_clientes (habla de duplicar clientes)

Asuntos:
${listaTexto}

Responde ÚNICAMENTE con JSON: {"clasificaciones": [numero_familia_del_1, numero_familia_del_2, ...]} en el mismo orden, un número por asunto.`;

  const resultado = await chatCompletionJSON({ system: prompt, user: "Clasifica.", maxTokens: 200 });
  return resultado.clasificaciones || [];
}

async function procesarCampania(db, nombre, filtro, campaignId) {
  const leadsCol = db.collection("leads");
  const leads = await leadsCol
    .find({ ...filtro, emailEstado: "enviado_a_campana", asuntoEmail: { $ne: "" } })
    .project({ _id: 1, correo: 1, asuntoEmail: 1 })
    .toArray();

  console.log(`\n=== ${nombre}: ${leads.length} leads con correo agregado a Smartlead ===`);

  console.log("Descargando estado real de la campaña completa...");
  const estadosReales = await obtenerEstadosDeCampania(campaignId);

  const yaEnviados = leads.filter((l) => {
    const real = estadosReales.get(l.correo?.toLowerCase());
    return real && real.status !== "STARTED";
  });
  const aunNoEnviados = leads.length - yaEnviados.length;
  console.log(`Realmente ya enviados por Smartlead: ${yaEnviados.length} | Aún en cola (STARTED, sin sincronizar): ${aunNoEnviados}`);

  // Clasificación de familia en lotes de 20 (barato: pocas decenas de
  // llamadas en vez de una por lead) — solo de los realmente enviados.
  const LOTE = 20;
  const familiasPorId = new Map();
  for (let i = 0; i < yaEnviados.length; i += LOTE) {
    const grupo = yaEnviados.slice(i, i + LOTE);
    try {
      const clasificaciones = await clasificarLoteDeAsuntos(grupo.map((l) => l.asuntoEmail));
      grupo.forEach((l, idx) => familiasPorId.set(String(l._id), FAMILIAS[clasificaciones[idx]] || "sin_clasificar"));
    } catch (err) {
      console.error("Error clasificando lote:", err.message);
      grupo.forEach((l) => familiasPorId.set(String(l._id), "sin_clasificar"));
    }
    console.log(`  Clasificados ${Math.min(i + LOTE, yaEnviados.length)}/${yaEnviados.length}`);
  }

  let sincronizados = 0;
  let errores = 0;
  for (let i = 0; i < yaEnviados.length; i++) {
    const lead = yaEnviados[i];
    const real = estadosReales.get(lead.correo.toLowerCase());
    try {
      const resultado = await obtenerAperturasReales(campaignId, real.leadId);
      await leadsCol.updateOne(
        { _id: lead._id },
        { $set: { aperturas: resultado?.aperturas ?? 0, familiaAsunto: familiasPorId.get(String(lead._id)) || "sin_clasificar", aperturasSincronizadoEn: new Date() } }
      );
      sincronizados++;
    } catch (err) {
      errores++;
    }
    if ((i + 1) % 50 === 0) console.log(`  Sincronizados ${i + 1}/${yaEnviados.length} (errores: ${errores})`);
  }

  console.log(`${nombre} listo: ${sincronizados} sincronizados, ${errores} errores, ${aunNoEnviados} todavía en cola (se reintentan la próxima corrida).`);
}

// Los 406 leads "smartlead_existente" (importados el 2026-09-09 como
// referencia de lo que YA estaba en Smartlead antes de este pipeline) se
// guardaron sin asuntoEmail — solo nombre/empresa/correo/smartleadLeadId.
// Aquí se rellena el asunto REAL desde Smartlead (no se inventa ni se
// regenera) para no perder esa fuente de datos históricos reales.
async function procesarSmartleadExistente(db, campaignId) {
  const leadsCol = db.collection("leads");
  const leads = await leadsCol
    .find({ origen: "smartlead_existente", smartleadLeadId: { $exists: true }, asuntoEmail: { $exists: false } })
    .project({ _id: 1, smartleadLeadId: 1 })
    .toArray();

  console.log(`\n=== Piloto LATAM (histórico real, smartlead_existente): ${leads.length} leads a rellenar ===`);

  let rellenados = 0;
  let sinAsunto = 0;
  let errores = 0;
  const paraClasificar = [];

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    try {
      const resultado = await obtenerAperturasReales(campaignId, lead.smartleadLeadId);
      if (!resultado?.subject) {
        sinAsunto++;
        continue;
      }
      await leadsCol.updateOne(
        { _id: lead._id },
        { $set: { asuntoEmail: resultado.subject, aperturas: resultado.aperturas, aperturasSincronizadoEn: new Date() } }
      );
      paraClasificar.push({ _id: lead._id, asuntoEmail: resultado.subject });
      rellenados++;
    } catch (err) {
      errores++;
    }
    if ((i + 1) % 50 === 0) console.log(`  Rellenados ${i + 1}/${leads.length} (sin asunto: ${sinAsunto}, errores: ${errores})`);
  }

  const LOTE = 20;
  for (let i = 0; i < paraClasificar.length; i += LOTE) {
    const grupo = paraClasificar.slice(i, i + LOTE);
    try {
      const clasificaciones = await clasificarLoteDeAsuntos(grupo.map((l) => l.asuntoEmail));
      for (let j = 0; j < grupo.length; j++) {
        await leadsCol.updateOne({ _id: grupo[j]._id }, { $set: { familiaAsunto: FAMILIAS[clasificaciones[j]] || "sin_clasificar" } });
      }
    } catch (err) {
      console.error("Error clasificando lote histórico:", err.message);
    }
  }

  console.log(`Histórico real listo: ${rellenados} rellenados, ${sinAsunto} sin asunto en Smartlead, ${errores} errores.`);
}

(async () => {
  const db = await getDb();
  await procesarSmartleadExistente(db, process.env.SMARTLEAD_CAMPAIGN_ID_LATAM);
  await procesarCampania(db, "Piloto LATAM", { origen: { $in: ORIGENES_LATAM } }, process.env.SMARTLEAD_CAMPAIGN_ID_LATAM);
  await procesarCampania(db, "Google Maps", { origenBusqueda: { $exists: true } }, process.env.SMARTLEAD_CAMPAIGN_ID);
  console.log("\nSincronización completa.");
  process.exit(0);
})().catch((e) => {
  console.error("ERROR FATAL:", e.message);
  process.exit(1);
});

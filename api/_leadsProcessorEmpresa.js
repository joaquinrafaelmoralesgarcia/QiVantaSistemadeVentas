const { revelarCorreo } = require("./_apollo");
const { procesarPersonaEmpresa } = require("./_leadsProcessorComun");

// Espejo de _leadsProcessor.js (Google Maps) pero para el pipeline de
// Piloto LATAM vía Apollo — pedido explícito del usuario el 2026-09-07:
// "en apollo debe obtenerse nuevos contactos diario, latam, todo tipo de
// empresa, 150 diarios" y "no hay que sacar ningún teléfono solo correos".
//
// Diferencia clave frente a Google Maps: Apollo cobra 1 crédito por cada
// candidato que se "revela" (revelarCorreo), incluso si ya se había
// revelado antes en un día anterior — por eso el dedup aquí es ANTES de
// revelar (por apolloId, nunca por correo, porque el correo real no se
// conoce hasta después de gastar el crédito). El paso de después de
// revelar (validar MX, generar el correo, mandar a Smartlead) vive en
// _leadsProcessorComun.js, compartido con Hunter y la importación manual.
//
// Si Apollo devuelve BILLING.LIMIT.CREDITS_EXHAUSTED, se detiene de
// inmediato (no tiene caso seguir intentando el resto de la página, todos
// fallarían igual) y lo reporta en detenidoPorErrores para que el cron no
// avance el cursor de página — mañana se reintenta la misma página.
// Tope de candidatos NUEVOS a procesar por corrida — no de cuántos se piden
// a Apollo. El costo real por candidato nuevo no son las 2 llamadas de red
// (revelar + Smartlead), es generarScriptEmpresa() generando el correo
// completo con IA (hasta 1300 tokens), varios segundos cada uno. Con 25
// candidatos por página no hay forma de saber de antemano cuántos serán
// nuevos — si le toca una página con muchos nuevos de golpe (pasó el
// 2026-09-10, intento 7 se colgó los 60s completos de Vercel sin
// terminar), igual se pasa del límite. Por eso se topa aquí el
// PROCESAMIENTO, no la página: si sobran nuevos sin procesar, se
// devuelven sin marcarlos como vistos (no se insertan en Mongo), así que
// la siguiente corrida los vuelve a encontrar como "nuevos" en la misma
// página (que no avanza, ver cron-scrape-empresas.js) y sigue donde se
// quedó, sin perder ninguno.
const MAX_NUEVOS_POR_CORRIDA = 6;

async function procesarPersonasApollo(coleccion, personas) {
  const ids = personas.map((p) => p.id);
  const existentes = await coleccion
    .find({ apolloId: { $in: ids } })
    .project({ apolloId: 1 })
    .toArray();
  const idsExistentes = new Set(existentes.map((e) => e.apolloId));
  const todasLasNuevas = personas.filter((p) => !idsExistentes.has(p.id));
  const nuevas = todasLasNuevas.slice(0, MAX_NUEVOS_POR_CORRIDA);
  const quedaronPendientes = todasLasNuevas.length > nuevas.length;

  let procesados = 0;
  let revelados = 0;
  let sinCorreoApollo = 0;
  let correosInvalidos = 0;
  let correosEnviados = 0;
  let erroresCorreo = 0;

  for (const persona of nuevas) {
    let revelado;
    try {
      revelado = await revelarCorreo(persona.id);
    } catch (err) {
      if (err.apolloCode === "BILLING.LIMIT.CREDITS_EXHAUSTED") {
        return {
          totalCandidatos: personas.length,
          yaExistian: personas.length - todasLasNuevas.length,
          quedaronPendientes,
          intentados: procesados,
          revelados,
          sinCorreoApollo,
          correosInvalidos,
          correosEnviados,
          erroresCorreo,
          detenidoPorErrores: true,
          motivoDetencion: "Sin créditos de Apollo disponibles (BILLING.LIMIT.CREDITS_EXHAUSTED).",
        };
      }
      console.error("Error revelando candidato de Apollo", persona.id, err.message);
      await coleccion.insertOne({ apolloId: persona.id, origen: "apollo_latam", estado: "error_apollo", errorApollo: err.message, createdAt: new Date() });
      procesados++;
      continue;
    }

    procesados++;

    if (!revelado || !revelado.correo) {
      sinCorreoApollo++;
      await coleccion.insertOne({ apolloId: persona.id, origen: "apollo_latam", estado: "sin_correo_apollo", createdAt: new Date() });
      continue;
    }
    revelados++;

    const { resultado } = await procesarPersonaEmpresa(coleccion, revelado, "apollo_latam", { apolloId: persona.id });
    if (resultado === "correo_invalido") correosInvalidos++;
    else if (resultado === "enviado") correosEnviados++;
    else if (resultado === "error_smartlead") erroresCorreo++;
  }

  return {
    totalCandidatos: personas.length,
    yaExistian: personas.length - todasLasNuevas.length,
    quedaronPendientes,
    intentados: nuevas.length,
    revelados,
    sinCorreoApollo,
    correosInvalidos,
    correosEnviados,
    erroresCorreo,
    detenidoPorErrores: false,
  };
}

module.exports = { procesarPersonasApollo };

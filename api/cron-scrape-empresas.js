// Scrapeo diario de contactos nuevos para Piloto LATAM — combina 2
// fuentes en un solo endpoint (Vercel Hobby limita a 12 funciones
// serverless, así que se consolidan aquí en vez de un archivo por
// fuente). Antes se llamaba cron-scrape-apollo.js; se renombró el
// 2026-09-07 al agregar Hunter como segunda fuente.
//
// 1. Apollo (_apollo.js) — descubre PERSONAS por seniority/país en LatAm,
//    búsqueda gratis + 1 crédito por correo revelado. Fuente principal
//    cuando hay créditos disponibles (se renuevan el 28 de septiembre).
// 2. Hunter.io (_hunter.js) — busca por DOMINIO de empresa ya conocido
//    (lista en _hunterDominios.js). Agregado el 2026-09-07 porque Apollo
//    se quedó sin créditos y Hunter sí da acceso a su API en el plan
//    gratis (Snov.io, Lusha, Kaspr y Adapt.io no la dan sin pagar).
//
// Las 2 fuentes corren en la misma invocación y sus resultados se suman;
// si una se queda sin crédito/dominios pendientes, la otra sigue.
const { getDb } = require("./_mongo");
const { buscarPersonas, obtenerCreditosLead } = require("./_apollo");
const { procesarPersonasApollo } = require("./_leadsProcessorEmpresa");
const { procesarDominiosHunter } = require("./_leadsProcessorHunter");

const PER_PAGE = 100;

// Pedido explícito del usuario el 2026-09-08: "agotemos primero todos los
// leads en méxico y ya más adelante brincaremos a otros países" — antes
// buscaba en las 17 países de LatAm a la vez. Para volver a cubrir toda
// LatAm más adelante, basta con cambiar esto a PAISES_LATAM (importado de
// _apollo.js) o a la lista de países que se quiera agregar.
const PAISES_APOLLO_ACTUAL = ["mexico"];

// Registra el saldo real de créditos de Apollo antes y después de revelar,
// y lo guarda en Mongo (colección "auditoriaCreditosApollo") — pedido
// explícito del usuario el 2026-09-08: "como garantizas que no se
// gastarán en balde" tras el episodio de los 2,541 créditos sin
// explicación clara. Esto convierte la garantía en algo verificable con
// datos de Apollo mismos, no en una promesa del código.
async function correrApollo(db) {
  const estadoCol = db.collection("estadoApollo");
  const estado = (await estadoCol.findOne({ _id: "cursorLatam" })) || { pagina: 1 };

  const creditosAntes = await obtenerCreditosLead().catch((err) => {
    console.error("No se pudo consultar créditos de Apollo antes de la corrida:", err.message);
    return null;
  });

  const { totalEncontrados, personas } = await buscarPersonas({ page: estado.pagina, perPage: PER_PAGE, paises: PAISES_APOLLO_ACTUAL });

  if (!personas.length) {
    await estadoCol.updateOne({ _id: "cursorLatam" }, { $set: { pagina: 1 } }, { upsert: true });
    return { paginaUsada: estado.pagina, totalEncontrados, sinCandidatosEnPagina: true, reinicio: true, correosEnviados: 0, detenidoPorErrores: false };
  }

  const stats = await procesarPersonasApollo(db.collection("leads"), personas);

  if (!stats.detenidoPorErrores) {
    await estadoCol.updateOne({ _id: "cursorLatam" }, { $set: { pagina: estado.pagina + 1 } }, { upsert: true });
  }

  const creditosDespues = await obtenerCreditosLead().catch((err) => {
    console.error("No se pudo consultar créditos de Apollo después de la corrida:", err.message);
    return null;
  });

  const creditosGastados = creditosAntes && creditosDespues ? creditosDespues.consumed - creditosAntes.consumed : null;
  const intentosQuePudieronCobrar = stats.revelados + (stats.sinCorreoApollo || 0); // revelar sin correo aún puede cobrar 1 crédito "demográfico" según Apollo, por eso se incluye
  await db.collection("auditoriaCreditosApollo").insertOne({
    fecha: new Date(),
    paginaUsada: estado.pagina,
    creditosAntes,
    creditosDespues,
    creditosGastados,
    correosEnviados: stats.correosEnviados,
    intentosQuePudieronCobrar,
    cuadra: creditosGastados === null ? null : creditosGastados <= intentosQuePudieronCobrar,
  });

  return { paginaUsada: estado.pagina, totalEncontrados, creditosGastados, ...stats };
}

module.exports = async function handler(req, res) {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: "No autorizado." });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const db = await getDb();

    const apollo = await correrApollo(db).catch((err) => {
      console.error("Error en fase Apollo:", err);
      return { error: err.message, correosEnviados: 0, detenidoPorErrores: true };
    });

    const hunter = process.env.HUNTER_API_KEY
      ? await procesarDominiosHunter(db).catch((err) => {
          console.error("Error en fase Hunter:", err);
          return { error: err.message, correosEnviados: 0, detenidoPorCuota: true, sinDominiosPendientes: false };
        })
      : { sinLlaveConfigurada: true, correosEnviados: 0, detenidoPorCuota: true, sinDominiosPendientes: false };

    const correosEnviados = (apollo.correosEnviados || 0) + (hunter.correosEnviados || 0);
    const hunterAgotado = Boolean(hunter.detenidoPorCuota || hunter.sinDominiosPendientes || hunter.sinLlaveConfigurada);
    const detenidoPorErrores = Boolean(apollo.detenidoPorErrores) && hunterAgotado;

    console.log("Piloto LATAM — Apollo:", JSON.stringify(apollo), "| Hunter:", JSON.stringify(hunter));
    res.status(200).json({ apollo, hunter, correosEnviados, detenidoPorErrores });
  } catch (err) {
    console.error("Error en cron-scrape-empresas:", err);
    res.status(500).json({ error: err.message || "Error en el scrapeo diario de Piloto LATAM." });
  }
};

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
const { buscarPersonas, obtenerCreditosLead, NIVELES_APOLLO } = require("./_apollo");
const { procesarPersonasApollo } = require("./_leadsProcessorEmpresa");
const { procesarDominiosHunter } = require("./_leadsProcessorHunter");
const { actualizarTopeCampania } = require("./_smartlead");

const PER_PAGE = 100;

// Las 6 cuentas de envío son compartidas entre Google Maps y Piloto
// LATAM (6 × 40/día = 240 de cupo total, desde que se subió el límite
// por cuenta el 2026-09-09). Pedido explícito del usuario el 2026-09-09:
// "la prioridad en volumen de correos a enviar era primero piloto latam
// y luego google maps" — un 40/40 no bastaba (el primer día real con
// ambos en 150 mandó MÁS Google Maps que Piloto LATAM, el orden de
// arranque por sí solo no fuerza la prioridad). Por eso el tope normal
// de Google Maps se bajó a 50 (Piloto LATAM se subió a 190, fuera de
// este archivo, vía Smartlead directo — no cambia dinámicamente, así
// que no hace falta mantenerlo aquí). Cuando Apollo/Hunter se quedan sin
// nada nuevo que mandar ese día, Google Maps sube a 240 (todo el cupo)
// para no dejarlo sin usar; en cuanto Apollo vuelve a tener leads,
// regresa solo a 50.
const TOPE_GOOGLE_MAPS_NORMAL = 50;
const TOPE_GOOGLE_MAPS_AMPLIADO = 240;

// Progresión automática de niveles (país + banda de tamaño de empresa) —
// pedido explícito del usuario el 2026-09-08: "cuando termines de
// recorrer todo méxico menos de 1000 empleados brincaremos de 1000 a
// 2000, luego de 2 mil a 3 mil, y luego iremos a otros países de latam".
// NIVELES_APOLLO (en _apollo.js) ya trae el orden completo — México
// primero, cada país en sus 3 bandas de tamaño. Cuando un nivel se agota
// (la búsqueda ya no encuentra candidatos ahí), se avanza solo al
// siguiente, sin que haga falta pedirlo de nuevo cada vez.
//
// Registra el saldo real de créditos de Apollo antes y después de
// revelar, y lo guarda en Mongo (colección "auditoriaCreditosApollo") —
// pedido explícito del usuario el 2026-09-08: "como garantizas que no se
// gastarán en balde" tras el episodio de los 2,541 créditos sin
// explicación clara. Esto convierte la garantía en algo verificable con
// datos de Apollo mismos, no en una promesa del código.
async function correrApollo(db) {
  const estadoCol = db.collection("estadoApollo");
  const estadoGuardado = await estadoCol.findOne({ _id: "cursorLatam" });
  // nivelIndex no existía antes del 2026-09-08 (progresión país+tamaño) —
  // si el documento es de antes, usa 0 (México, banda 1-1000) sin tronar.
  const estado = { nivelIndex: estadoGuardado?.nivelIndex ?? 0, pagina: estadoGuardado?.pagina ?? 1 };
  const nivel = NIVELES_APOLLO[estado.nivelIndex % NIVELES_APOLLO.length];

  const creditosAntes = await obtenerCreditosLead().catch((err) => {
    console.error("No se pudo consultar créditos de Apollo antes de la corrida:", err.message);
    return null;
  });

  const { totalEncontrados, personas } = await buscarPersonas({
    page: estado.pagina,
    perPage: PER_PAGE,
    paises: [nivel.pais],
    rangosEmpleados: [nivel.banda],
  });

  if (!personas.length) {
    // Se agotó este nivel (país+tamaño) — avanza al siguiente de la lista.
    const siguienteIndex = (estado.nivelIndex + 1) % NIVELES_APOLLO.length;
    await estadoCol.updateOne({ _id: "cursorLatam" }, { $set: { nivelIndex: siguienteIndex, pagina: 1 } }, { upsert: true });
    const siguienteNivel = NIVELES_APOLLO[siguienteIndex];
    return {
      nivel, totalEncontrados, sinCandidatosEnNivel: true, avanzoDeNivel: true,
      siguienteNivel, correosEnviados: 0, detenidoPorErrores: false,
    };
  }

  const stats = await procesarPersonasApollo(db.collection("leads"), personas);

  if (!stats.detenidoPorErrores) {
    await estadoCol.updateOne({ _id: "cursorLatam" }, { $set: { nivelIndex: estado.nivelIndex, pagina: estado.pagina + 1 } }, { upsert: true });
  }

  const creditosDespues = await obtenerCreditosLead().catch((err) => {
    console.error("No se pudo consultar créditos de Apollo después de la corrida:", err.message);
    return null;
  });

  const creditosGastados = creditosAntes && creditosDespues ? creditosDespues.consumed - creditosAntes.consumed : null;
  const intentosQuePudieronCobrar = stats.revelados + (stats.sinCorreoApollo || 0); // revelar sin correo aún puede cobrar 1 crédito "demográfico" según Apollo, por eso se incluye
  await db.collection("auditoriaCreditosApollo").insertOne({
    fecha: new Date(),
    nivel,
    paginaUsada: estado.pagina,
    creditosAntes,
    creditosDespues,
    creditosGastados,
    correosEnviados: stats.correosEnviados,
    intentosQuePudieronCobrar,
    cuadra: creditosGastados === null ? null : creditosGastados <= intentosQuePudieronCobrar,
  });

  return { nivel, paginaUsada: estado.pagina, totalEncontrados, creditosGastados, ...stats };
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

    const topeGoogleMapsDeseado = detenidoPorErrores ? TOPE_GOOGLE_MAPS_AMPLIADO : TOPE_GOOGLE_MAPS_NORMAL;
    const ajusteGoogleMaps = await actualizarTopeCampania(process.env.SMARTLEAD_CAMPAIGN_ID, topeGoogleMapsDeseado).catch((err) => {
      console.error("No se pudo ajustar el tope de Google Maps:", err.message);
      return { error: err.message };
    });

    console.log("Piloto LATAM — Apollo:", JSON.stringify(apollo), "| Hunter:", JSON.stringify(hunter), "| Tope Google Maps:", JSON.stringify(ajusteGoogleMaps));
    res.status(200).json({ apollo, hunter, correosEnviados, detenidoPorErrores, ajusteGoogleMaps });
  } catch (err) {
    console.error("Error en cron-scrape-empresas:", err);
    res.status(500).json({ error: err.message || "Error en el scrapeo diario de Piloto LATAM." });
  }
};

// Scraping de negocios en Google Maps vía Apify (actor compass/crawler-google-places).
// Campos de entrada/salida verificados con una corrida real el 2026-09-01:
// title, address, phone/phoneUnformatted, website, totalScore, reviewsCount,
// categoryName, url y (con scrapeContacts:true) emails[] — coinciden con el
// mapeo de normalizarResultado(). scrapeContacts es un add-on de pago: sin él
// el actor nunca devuelve correo, así que va activado por default aquí.
const { detectarEmpresaGrande } = require("./_empresaGrande");

const APIFY_ACTOR_ID = process.env.APIFY_ACTOR_ID || "compass~crawler-google-places";

// El scraping con scrapeContacts:true (necesario para sacar correos) es
// lento — medido: ~87s para solo 5 negocios — y Vercel Hobby corta las
// funciones a los 60s. Por eso se corre asíncrono: iniciarBusqueda() dispara
// la corrida y regresa de inmediato (no espera), consultarBusqueda() se
// llama después (desde el frontend, en polling) para ver si ya terminó.
async function iniciarBusqueda({ query, location, maxResultados = 30 }) {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    throw new Error("Falta configurar APIFY_API_TOKEN.");
  }

  const searchString = location ? `${query} en ${location}` : query;

  const url = `https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/runs?token=${encodeURIComponent(token)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      searchStringsArray: [searchString],
      maxCrawledPlacesPerSearch: maxResultados,
      language: "es",
      scrapeContacts: true, // add-on de pago: sin esto nunca regresa "emails"
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Apify respondió con error (${res.status}): ${errBody}`);
  }

  const data = await res.json();
  return { runId: data.data.id, datasetId: data.data.defaultDatasetId, status: data.data.status };
}

// Devuelve { listo: false } mientras sigue corriendo, o { listo: true, negocios }
// cuando terminó (SUCCEEDED). Lanza error si Apify marcó la corrida como fallida.
async function consultarBusqueda(runId) {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    throw new Error("Falta configurar APIFY_API_TOKEN.");
  }

  const resRun = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${encodeURIComponent(token)}`);
  if (!resRun.ok) {
    throw new Error(`No se pudo consultar el estado de la corrida (${resRun.status}).`);
  }
  const run = await resRun.json();
  const status = run.data.status;

  if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
    throw new Error(`La corrida de Apify terminó con estado ${status}.`);
  }
  if (status !== "SUCCEEDED") {
    return { listo: false, status };
  }

  const datasetId = run.data.defaultDatasetId;
  const resItems = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${encodeURIComponent(token)}`);
  if (!resItems.ok) {
    throw new Error(`No se pudieron obtener los resultados (${resItems.status}).`);
  }
  const items = await resItems.json();
  const negocios = (Array.isArray(items) ? items : []).map(normalizarResultado).filter((n) => n.nombre && n.telefono);
  return { listo: true, status, negocios };
}

function normalizarResultado(item) {
  const negocio = {
    nombre: item.title || item.name || "",
    direccion: item.address || item.street || "",
    telefono: (item.phone || item.phoneUnformatted || "").toString().trim(),
    sitioWeb: item.website || "",
    tieneSitioWeb: Boolean(item.website),
    calificacionGoogle: item.totalScore || item.rating || null,
    numResenas: item.reviewsCount || null,
    categoria: item.categoryName || item.category || "",
    correo: item.email || (Array.isArray(item.emails) ? item.emails[0] : "") || "",
    googleMapsUrl: item.url || item.googleMapsUrl || "",
  };

  // Google Maps no tiene número de empleados (a diferencia de Apollo) —
  // se estima con señales observables. Ver _empresaGrande.js. Pedido
  // explícito del usuario el 2026-09-10.
  const { probablementeGrande, senales } = detectarEmpresaGrande(negocio);
  negocio.probablementeGrande = probablementeGrande;
  negocio.senalesEmpresaGrande = senales;

  return negocio;
}

module.exports = { iniciarBusqueda, consultarBusqueda };

// Scraping de negocios en Google Maps vía Apify.
//
// Requiere una cuenta de Apify (apify.com) con el actor "Google Maps Scraper"
// activado (Apify Store → busca "Google Maps Scraper", el más usado es
// compass/crawler-google-places). El nombre exacto del actor y de los campos
// de entrada/salida puede cambiar — verifica en la página del actor en Apify
// Console (pestaña "Input"/"API") antes del primer uso real y ajusta
// ACTOR_INPUT / el mapeo en normalizarResultado si hace falta.
const APIFY_ACTOR_ID = process.env.APIFY_ACTOR_ID || "compass~crawler-google-places";

async function buscarNegocios({ query, location, maxResultados = 30 }) {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    throw new Error("Falta configurar APIFY_API_TOKEN.");
  }

  const searchString = location ? `${query} en ${location}` : query;

  const url = `https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      searchStringsArray: [searchString],
      maxCrawledPlacesPerSearch: maxResultados,
      language: "es",
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Apify respondió con error (${res.status}): ${errBody}`);
  }

  const items = await res.json();
  return (Array.isArray(items) ? items : []).map(normalizarResultado).filter((n) => n.nombre && n.telefono);
}

function normalizarResultado(item) {
  return {
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
}

module.exports = { buscarNegocios };

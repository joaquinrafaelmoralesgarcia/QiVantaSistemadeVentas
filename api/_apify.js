// Scraping de negocios en Google Maps vía Apify (actor compass/crawler-google-places).
// Campos de entrada/salida verificados con una corrida real el 2026-09-01:
// title, address, phone/phoneUnformatted, website, totalScore, reviewsCount,
// categoryName, url y (con scrapeContacts:true) emails[] — coinciden con el
// mapeo de normalizarResultado(). scrapeContacts es un add-on de pago: sin él
// el actor nunca devuelve correo, así que va activado por default aquí.
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
      scrapeContacts: true, // add-on de pago: sin esto nunca regresa "emails"
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

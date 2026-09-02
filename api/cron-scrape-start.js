// Dispara automáticamente una búsqueda diaria en Apify — categoría y ciudad
// elegidas al azar de api/_prospectingSegments.js para dar cobertura amplia
// (cualquier rubro, cualquier ciudad) con el tiempo. Se llama desde el
// workflow de GitHub Actions (.github/workflows/cron-scrape-diario.yml).
const { iniciarBusqueda } = require("./_apify");
const { CATEGORIAS, CIUDADES, elegirAlAzar } = require("./_prospectingSegments");

const MAX_RESULTADOS = 30;

module.exports = async function handler(req, res) {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: "No autorizado." });
    return;
  }

  try {
    const query = elegirAlAzar(CATEGORIAS);
    const location = elegirAlAzar(CIUDADES);

    const { runId } = await iniciarBusqueda({ query, location, maxResultados: MAX_RESULTADOS });
    console.log(`Scrapeo diario iniciado: "${query}" en "${location}" (runId ${runId})`);
    res.status(200).json({ runId, query, location });
  } catch (err) {
    console.error("Error en cron-scrape-start:", err);
    res.status(500).json({ error: err.message || "Error al iniciar el scrapeo diario." });
  }
};

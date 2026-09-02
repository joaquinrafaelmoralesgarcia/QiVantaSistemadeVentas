// Consulta (en polling desde GitHub Actions) el resultado del scrapeo diario
// disparado por api/cron-scrape-start.js, y cuando termina, procesa los
// negocios encontrados igual que el flujo manual del panel (dedup +
// calificación con Claude + correo automático a Smartlead si hay email).
const { getDb } = require("./_mongo");
const { consultarBusqueda } = require("./_apify");
const { procesarNegocios } = require("./_leadsProcessor");

module.exports = async function handler(req, res) {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: "No autorizado." });
    return;
  }

  try {
    const { runId, query } = req.query || {};
    if (!runId) {
      res.status(400).json({ error: "Falta 'runId'." });
      return;
    }

    const resultado = await consultarBusqueda(runId);
    if (!resultado.listo) {
      res.status(200).json({ listo: false, status: resultado.status });
      return;
    }

    const db = await getDb();
    const coleccion = db.collection("leads");
    const stats = await procesarNegocios(coleccion, resultado.negocios, query || "");

    console.log("Scrapeo diario terminado:", JSON.stringify(stats));
    res.status(200).json({ listo: true, ...stats });
  } catch (err) {
    console.error("Error en cron-scrape-status:", err);
    res.status(500).json({ error: err.message || "Error al consultar el scrapeo diario." });
  }
};

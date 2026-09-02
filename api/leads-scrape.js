// Disparar (POST) y consultar (GET) el scrapeo manual desde el panel, en un
// solo archivo — igual que cron-scrape.js, consolidado por el límite de 12
// funciones serverless de Vercel Hobby.
const { getDb } = require("./_mongo");
const { requiereAdmin } = require("./_adminAuth");
const { iniciarBusqueda, consultarBusqueda } = require("./_apify");
const { procesarNegocios } = require("./_leadsProcessor");

module.exports = async function handler(req, res) {
  if (!requiereAdmin(req, res)) return;

  try {
    if (req.method === "POST") {
      const { query, location, maxResultados } = req.body || {};
      if (!query) {
        res.status(400).json({ error: "Falta 'query' (ej. 'gimnasios')." });
        return;
      }
      const { runId } = await iniciarBusqueda({ query, location, maxResultados: maxResultados || 30 });
      res.status(200).json({ runId, query });
      return;
    }

    if (req.method === "GET") {
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
      const stats = await procesarNegocios(db.collection("leads"), resultado.negocios, query || "");
      res.status(200).json({ listo: true, ...stats });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error en el scrapeo." });
  }
};

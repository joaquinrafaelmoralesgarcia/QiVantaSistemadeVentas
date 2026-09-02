const { getDb } = require("./_mongo");
const { requiereAdmin } = require("./_adminAuth");
const { consultarBusqueda } = require("./_apify");
const { procesarNegocios } = require("./_leadsProcessor");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!requiereAdmin(req, res)) return;

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

    res.status(200).json({ listo: true, ...stats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error al consultar la búsqueda." });
  }
};

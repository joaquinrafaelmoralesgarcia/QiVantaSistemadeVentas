const { requiereAdmin } = require("./_adminAuth");
const { iniciarBusqueda } = require("./_apify");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!requiereAdmin(req, res)) return;

  try {
    const { query, location, maxResultados } = req.body || {};
    if (!query) {
      res.status(400).json({ error: "Falta 'query' (ej. 'gimnasios')." });
      return;
    }

    const { runId } = await iniciarBusqueda({ query, location, maxResultados: maxResultados || 30 });
    res.status(200).json({ runId, query });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error al iniciar la búsqueda." });
  }
};

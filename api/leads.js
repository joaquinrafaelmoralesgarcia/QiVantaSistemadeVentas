const { getDb } = require("./_mongo");
const { requiereAdmin } = require("./_adminAuth");
const { ObjectId } = require("mongodb");

module.exports = async function handler(req, res) {
  if (!requiereAdmin(req, res)) return;

  try {
    const db = await getDb();
    const coleccion = db.collection("leads");

    if (req.method === "GET") {
      const { estado } = req.query || {};
      const filtro = estado ? { estado } : {};
      const leads = await coleccion.find(filtro).sort({ createdAt: -1 }).limit(500).toArray();
      res.status(200).json({ leads });
      return;
    }

    if (req.method === "PATCH") {
      const { id, estado } = req.body || {};
      if (!id || !estado) {
        res.status(400).json({ error: "Faltan 'id' y/o 'estado'." });
        return;
      }
      await coleccion.updateOne({ _id: new ObjectId(id) }, { $set: { estado, updatedAt: new Date() } });
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error al procesar los leads." });
  }
};

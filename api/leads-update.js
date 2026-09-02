const { getDb } = require("./_mongo");
const { requiereAdmin } = require("./_adminAuth");
const { ObjectId } = require("mongodb");

const CAMPOS_EDITABLES = ["mensajeWhatsapp", "asuntoEmail", "cuerpoEmail"];

module.exports = async function handler(req, res) {
  if (req.method !== "PATCH") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!requiereAdmin(req, res)) return;

  try {
    const { id, ...cambios } = req.body || {};
    if (!id) {
      res.status(400).json({ error: "Falta 'id'." });
      return;
    }

    const set = {};
    for (const campo of CAMPOS_EDITABLES) {
      if (typeof cambios[campo] === "string") set[campo] = cambios[campo];
    }
    if (!Object.keys(set).length) {
      res.status(400).json({ error: "No hay campos editables en el body (mensajeWhatsapp, asuntoEmail, cuerpoEmail)." });
      return;
    }
    set.updatedAt = new Date();

    const db = await getDb();
    await db.collection("leads").updateOne({ _id: new ObjectId(id) }, { $set: set });
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error al actualizar el lead." });
  }
};

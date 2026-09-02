const { getDb } = require("./_mongo");
const { requiereAdmin } = require("./_adminAuth");

const COLECCION_POR_CANAL = {
  whatsapp: { nombre: "wati_conversaciones", campoId: "waId" },
  web: { nombre: "widget_conversaciones", campoId: "sessionId" },
};

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!requiereAdmin(req, res)) return;

  try {
    const { canal, id } = req.query || {};
    const config = COLECCION_POR_CANAL[canal];
    if (!config || !id) {
      res.status(400).json({ error: "Faltan o son inválidos 'canal' y/o 'id'." });
      return;
    }

    const db = await getDb();
    const doc = await db.collection(config.nombre).findOne({ [config.campoId]: id });
    res.status(200).json({ mensajes: doc?.mensajes || [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error al obtener la conversación." });
  }
};

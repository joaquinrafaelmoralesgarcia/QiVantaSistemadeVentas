// Vista unificada de conversaciones (WhatsApp vía WATI + widget web) para el
// panel /admin-mensajes.html. Mayormente de solo lectura: la IA ya responde
// ambos canales automáticamente, este endpoint no manda mensajes. La única
// escritura es PATCH para reactivar el bot en una conversación de WhatsApp
// que quedó pausada porque un humano (tú) le contestó directo — sin esto la
// pausa sería permanente sin forma de deshacerla desde el panel.
// Lista (sin 'id') y detalle de una conversación (con 'id') consolidados en
// un solo archivo por el límite de 12 funciones serverless de Vercel Hobby.
const { getDb } = require("./_mongo");
const { requiereAdmin } = require("./_adminAuth");

const COLECCION_POR_CANAL = {
  whatsapp: { nombre: "wati_conversaciones", campoId: "waId" },
  web: { nombre: "widget_conversaciones", campoId: "sessionId" },
};

function ultimoTexto(mensajes) {
  const ultimo = (mensajes || [])[mensajes.length - 1];
  return ultimo ? String(ultimo.content || "").slice(0, 140) : "";
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "PATCH") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!requiereAdmin(req, res)) return;

  try {
    const db = await getDb();
    const { canal, id } = req.query || {};

    if (req.method === "PATCH") {
      if (canal !== "whatsapp" || !id) {
        res.status(400).json({ error: "PATCH solo aplica a canal=whatsapp con 'id' (waId)." });
        return;
      }
      await db
        .collection("wati_conversaciones")
        .updateOne({ waId: id }, { $set: { humanTomoControl: false }, $unset: { humanTomoControlPor: "", humanTomoControlEn: "" } });
      res.status(200).json({ ok: true });
      return;
    }

    if (id) {
      const config = COLECCION_POR_CANAL[canal];
      if (!config) {
        res.status(400).json({ error: "'canal' inválido (usa 'whatsapp' o 'web')." });
        return;
      }
      const doc = await db.collection(config.nombre).findOne({ [config.campoId]: id });
      res.status(200).json({
        mensajes: doc?.mensajes || [],
        datosContacto: doc?.contacto || null,
        humanTomoControl: !!doc?.humanTomoControl,
        humanTomoControlPor: doc?.humanTomoControlPor || null,
      });
      return;
    }

    const whatsapp =
      canal && canal !== "whatsapp"
        ? []
        : await db.collection("wati_conversaciones").find({}).sort({ updatedAt: -1 }).limit(200).toArray();

    const web =
      canal && canal !== "web"
        ? []
        : await db.collection("widget_conversaciones").find({}).sort({ updatedAt: -1 }).limit(200).toArray();

    const conversaciones = [
      ...whatsapp.map((c) => ({
        canal: "whatsapp",
        id: c.waId,
        contacto: c.waId,
        humanTomoControl: !!c.humanTomoControl,
        totalMensajes: (c.mensajes || []).length,
        ultimoMensaje: ultimoTexto(c.mensajes),
        updatedAt: c.updatedAt,
      })),
      ...web.map((c) => ({
        canal: "web",
        id: c.sessionId,
        contacto: c.contacto?.nombre || `Visitante ${String(c.sessionId).slice(-6)}`,
        datosContacto: c.contacto || null,
        totalMensajes: (c.mensajes || []).length,
        ultimoMensaje: ultimoTexto(c.mensajes),
        updatedAt: c.updatedAt,
      })),
    ].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    res.status(200).json({ conversaciones });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error al obtener las conversaciones." });
  }
};

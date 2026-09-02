// Dispara manualmente el correo de un lead a Smartlead — ya NO es automático
// desde leads-scrape.js, se dispara desde el panel una vez que se revisó
// (y opcionalmente editó vía api/leads-update.js) el asunto/cuerpo.
const { getDb } = require("./_mongo");
const { requiereAdmin } = require("./_adminAuth");
const { agregarLeadACampania } = require("./_smartlead");
const { ObjectId } = require("mongodb");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!requiereAdmin(req, res)) return;

  try {
    const { id } = req.body || {};
    if (!id) {
      res.status(400).json({ error: "Falta 'id'." });
      return;
    }

    const db = await getDb();
    const coleccion = db.collection("leads");
    const lead = await coleccion.findOne({ _id: new ObjectId(id) });
    if (!lead) {
      res.status(404).json({ error: "Lead no encontrado." });
      return;
    }
    if (!lead.correo) {
      res.status(400).json({ error: "Este lead no tiene correo." });
      return;
    }

    try {
      await agregarLeadACampania({
        nombre: lead.nombre,
        correo: lead.correo,
        empresa: lead.nombre,
        telefono: lead.telefono,
        customFields: {
          qi_vanta_subject: lead.asuntoEmail || `Automatización e IA para ${lead.nombre}`,
          qi_vanta_message: lead.cuerpoEmail || "",
        },
      });
      await coleccion.updateOne({ _id: lead._id }, { $set: { emailEstado: "enviado_a_campana", emailEnviadoAt: new Date() } });
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error("Error mandando a Smartlead:", err);
      await coleccion.updateOne({ _id: lead._id }, { $set: { emailEstado: "error", emailError: err.message } });
      res.status(500).json({ error: err.message || "Error al mandar el correo." });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error al procesar la solicitud." });
  }
};

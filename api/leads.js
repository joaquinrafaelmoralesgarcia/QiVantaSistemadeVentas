// Listar/filtrar leads (GET), editar estado o mensajes (PATCH), y disparar
// el envío de correo a Smartlead (POST) — consolidado en un solo archivo
// por el límite de 12 funciones serverless de Vercel Hobby.
const { getDb } = require("./_mongo");
const { requiereAdmin } = require("./_adminAuth");
const { agregarLeadACampania } = require("./_smartlead");
const { ObjectId } = require("mongodb");

const CAMPOS_MENSAJE = ["mensajeWhatsapp", "asuntoEmail", "cuerpoEmail"];

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
      const { id, estado, ...cambios } = req.body || {};
      if (!id) {
        res.status(400).json({ error: "Falta 'id'." });
        return;
      }

      const set = { updatedAt: new Date() };
      if (typeof estado === "string") set.estado = estado;
      for (const campo of CAMPOS_MENSAJE) {
        if (typeof cambios[campo] === "string") set[campo] = cambios[campo];
      }
      if (Object.keys(set).length === 1) {
        res.status(400).json({ error: "No hay nada que actualizar (estado o mensajeWhatsapp/asuntoEmail/cuerpoEmail)." });
        return;
      }

      await coleccion.updateOne({ _id: new ObjectId(id) }, { $set: set });
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === "POST") {
      // Dispara manualmente el correo a Smartlead (ej. reintentar uno que falló).
      const { id } = req.body || {};
      if (!id) {
        res.status(400).json({ error: "Falta 'id'." });
        return;
      }
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
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error al procesar los leads." });
  }
};

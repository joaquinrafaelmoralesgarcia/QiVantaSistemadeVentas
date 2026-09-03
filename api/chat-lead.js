// Recibe los datos de contacto que el widget web pide al cliente (nombre,
// teléfono, empresa, número de empleados) después del 3er mensaje. Guarda
// junto con el histórico de esa sesión (widget_conversaciones) y manda una
// notificación por correo a info@qi-vanta.com con el histórico completo,
// para que el equipo pueda dar seguimiento — pedido explícito del usuario
// el 2026-09-03.
const { getDb } = require("./_mongo");
const { aplicarCors } = require("./_cors");
const { enviarCorreoInterno } = require("./_mailer");

function formatearTranscripcion(mensajes) {
  if (!mensajes || !mensajes.length) return "(sin mensajes previos)";
  return mensajes.map((m) => `${m.role === "user" ? "Cliente" : "Bot"}: ${m.content}`).join("\n\n");
}

module.exports = async function handler(req, res) {
  if (aplicarCors(req, res)) return;

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { sessionId, nombre, telefono, empresa, numEmpleados } = req.body || {};
    if (!sessionId || !nombre || !telefono || !empresa || !numEmpleados) {
      res.status(400).json({ error: "Faltan campos requeridos." });
      return;
    }

    const contacto = {
      nombre: String(nombre).slice(0, 200),
      telefono: String(telefono).slice(0, 30),
      empresa: String(empresa).slice(0, 200),
      numEmpleados: String(numEmpleados).slice(0, 30),
      capturadoEn: new Date(),
    };

    const db = await getDb();
    await db.collection("widget_conversaciones").updateOne(
      { sessionId },
      { $set: { sessionId, contacto, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date(), mensajes: [] } },
      { upsert: true }
    );

    const doc = await db.collection("widget_conversaciones").findOne({ sessionId });

    if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
      try {
        await enviarCorreoInterno({
          asunto: `Nuevo lead del chat web: ${contacto.nombre} (${contacto.empresa})`,
          texto: [
            `Nombre: ${contacto.nombre}`,
            `Teléfono: ${contacto.telefono}`,
            `Empresa: ${contacto.empresa}`,
            `Número de empleados: ${contacto.numEmpleados}`,
            `Session ID: ${sessionId}`,
            "",
            "--- Conversación completa ---",
            "",
            formatearTranscripcion(doc?.mensajes),
          ].join("\n"),
        });
      } catch (err) {
        // No debe romper la respuesta al cliente si falla el correo — el dato
        // ya quedó guardado en Mongo, se puede reenviar/consultar después.
        console.error("Error enviando correo de notificación de lead:", err.message);
      }
    } else {
      console.error("Falta configurar GMAIL_USER/GMAIL_APP_PASSWORD — no se envió correo de notificación.");
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudieron guardar tus datos." });
  }
};

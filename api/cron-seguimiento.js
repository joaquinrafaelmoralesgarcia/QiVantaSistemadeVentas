// Cron job (ver vercel.json) que manda hasta 2 mensajes de seguimiento por
// WhatsApp cuando el cliente no responde después de que el bot contestó:
//   - 30 min sin respuesta -> seguimiento 1
//   - 60 min sin respuesta -> seguimiento 2 (último, ya no se manda más)
// Solo aplica a clientes que YA escribieron primero (dentro de la ventana de
// 24h de WhatsApp) — nunca a contactos fríos. El "reloj" se reinicia cada vez
// que el bot contesta algo nuevo (ver guardarHistorial en wati-webhook.js).
const { getDb } = require("./_mongo");
const { enviarRespuestaWati } = require("./_watiSend");

const TREINTA_MIN_MS = 30 * 60 * 1000;
const UNA_HORA_MS = 60 * 60 * 1000;

const MENSAJE_SEGUIMIENTO_1 =
  "Hola de nuevo 👋 ¿Sigues por ahí? Quedo atento si tienes alguna otra duda sobre cómo Qi-Vanta puede ayudarte.";
const MENSAJE_SEGUIMIENTO_2 =
  "No quiero ser insistente, así que este es mi último mensaje por ahora 🙂 Si más adelante quieres retomar la conversación, aquí sigo, o puedes contactar directo al equipo de Qi-Vanta: +52 720 644 22 83.";

module.exports = async function handler(req, res) {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: "No autorizado." });
    return;
  }

  try {
    const db = await getDb();
    const coleccion = db.collection("wati_conversaciones");
    const ahora = Date.now();

    let seguimiento1 = 0;
    let seguimiento2 = 0;

    // Seguimiento 1: 30+ min sin respuesta, todavía no se mandó.
    const candidatos1 = await coleccion
      .find({ "seguimiento.ultimaRespuestaBot": { $lte: new Date(ahora - TREINTA_MIN_MS) }, "seguimiento.seguimiento1Enviado": false })
      .toArray();

    for (const conv of candidatos1) {
      // Update atómico condicionado: si dos corridas del cron se traslapan, solo una gana.
      const resultado = await coleccion.updateOne(
        { _id: conv._id, "seguimiento.seguimiento1Enviado": false },
        { $set: { "seguimiento.seguimiento1Enviado": true }, $push: { mensajes: { role: "assistant", content: MENSAJE_SEGUIMIENTO_1 } } }
      );
      if (resultado.modifiedCount === 0) continue;

      try {
        await enviarRespuestaWati(conv.waId, MENSAJE_SEGUIMIENTO_1);
        seguimiento1++;
      } catch (err) {
        console.error("Error mandando seguimiento 1 a", conv.waId, err.message);
      }
    }

    // Seguimiento 2: 60+ min sin respuesta, seguimiento 1 ya se mandó, seguimiento 2 no.
    const candidatos2 = await coleccion
      .find({
        "seguimiento.ultimaRespuestaBot": { $lte: new Date(ahora - UNA_HORA_MS) },
        "seguimiento.seguimiento1Enviado": true,
        "seguimiento.seguimiento2Enviado": false,
      })
      .toArray();

    for (const conv of candidatos2) {
      const resultado = await coleccion.updateOne(
        { _id: conv._id, "seguimiento.seguimiento2Enviado": false },
        { $set: { "seguimiento.seguimiento2Enviado": true }, $push: { mensajes: { role: "assistant", content: MENSAJE_SEGUIMIENTO_2 } } }
      );
      if (resultado.modifiedCount === 0) continue;

      try {
        await enviarRespuestaWati(conv.waId, MENSAJE_SEGUIMIENTO_2);
        seguimiento2++;
      } catch (err) {
        console.error("Error mandando seguimiento 2 a", conv.waId, err.message);
      }
    }

    res.status(200).json({ ok: true, seguimiento1Enviados: seguimiento1, seguimiento2Enviados: seguimiento2 });
  } catch (err) {
    console.error("Error en cron-seguimiento:", err);
    res.status(500).json({ error: err.message });
  }
};

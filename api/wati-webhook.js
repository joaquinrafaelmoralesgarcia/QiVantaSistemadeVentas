// Webhook de WhatsApp vía WATI.
//
// IMPORTANTE — pendiente de verificar con una cuenta real de WATI:
//   1) El nombre exacto de los campos que WATI manda en el webhook de "mensaje
//      entrante" puede variar por versión de cuenta. Este handler intenta varias
//      variantes conocidas (waId/whatsappNumber, text/data.text, type/eventType),
//      pero si no llega nada útil, revisa los logs de Vercel: se imprime el body
//      crudo con console.log para poder ajustar el mapeo exacto.
//   2) WATI_API_ENDPOINT es la URL base de TU cuenta (aparece en el panel de WATI,
//      sección API Docs) — típicamente algo como
//      https://live-mt-server.wati.io/<tenantId> o https://live-server-XXXX.wati.io/<tenantId>.
//      No es la misma para todas las cuentas, así que debe configurarse por env var.
const { client } = require("./_anthropicClient");
const { getDb } = require("./_mongo");
const { SYSTEM_PROMPT } = require("./_systemPrompt");
const MAX_HISTORY = 16;

function extraerMensajeEntrante(body) {
  // WATI puede mandar el payload plano o envuelto en "data" según el evento.
  const d = body?.data || body || {};

  const waId = d.waId || d.whatsappNumber || d.phone || body?.waId;
  const texto = d.text || d.messageText || d.body || body?.text;
  const tipo = d.type || d.eventType || body?.eventType || "";
  const nombre = d.senderName || d.name || "";
  // WATI reintenta la entrega del webhook (confirmado: mismo mensaje repetido
  // cada ~10 min si algo falla del lado nuestro) — se necesita un id estable
  // para deduplicar. whatsappMessageId es el id real de Meta; "id" es el
  // identificador interno de WATI, siempre presente como respaldo.
  const idMensaje = d.whatsappMessageId || d.id || body?.whatsappMessageId || body?.id;

  // Ignora eventos que no sean mensajes de texto entrantes (ej. "sent"/"delivered"/"read" de nuestros propios envíos).
  const esEntrante =
    d.owner === false || d.fromMe === false || tipo === "message" || tipo === "text" || (!("owner" in d) && !("fromMe" in d));

  if (!waId || !texto || !esEntrante) return null;

  return { waId: String(waId), texto: String(texto), nombre: String(nombre || ""), idMensaje: idMensaje ? String(idMensaje) : null };
}

async function yaFueProcesado(db, idMensaje) {
  if (!idMensaje) return false; // sin id no podemos deduplicar, se procesa (mejor a que se pierda)
  try {
    await db.collection("wati_mensajes_procesados").insertOne({ _id: idMensaje, processedAt: new Date() });
    return false; // se pudo insertar -> es la primera vez que se ve este mensaje
  } catch (err) {
    if (err?.code === 11000) return true; // ya existía -> reintento duplicado de WATI
    throw err;
  }
}

async function enviarRespuestaWati(waId, texto) {
  const baseUrl = process.env.WATI_API_ENDPOINT;
  const token = process.env.WATI_API_TOKEN;

  if (!baseUrl || !token) {
    throw new Error("Falta configurar WATI_API_ENDPOINT y/o WATI_API_TOKEN.");
  }

  const url = `${baseUrl.replace(/\/$/, "")}/api/v1/sendSessionMessage/${encodeURIComponent(waId)}?messageText=${encodeURIComponent(texto)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`WATI respondió con error (${res.status}): ${errBody}`);
  }
}

async function obtenerHistorial(db, waId) {
  const doc = await db.collection("wati_conversaciones").findOne({ waId });
  return doc?.mensajes || [];
}

async function guardarHistorial(db, waId, mensajes) {
  await db.collection("wati_conversaciones").updateOne(
    { waId },
    { $set: { waId, mensajes: mensajes.slice(-MAX_HISTORY), updatedAt: new Date() } },
    { upsert: true }
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  console.log("WATI webhook body:", JSON.stringify(req.body));

  try {
    const mensaje = extraerMensajeEntrante(req.body);
    if (!mensaje) {
      // No es un mensaje de texto entrante (ej. evento de estado) — se responde 200 igual para que WATI no reintente.
      res.status(200).json({ ok: true, ignorado: true });
      return;
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("Falta ANTHROPIC_API_KEY.");
      res.status(200).json({ ok: false });
      return;
    }

    const db = await getDb();

    if (await yaFueProcesado(db, mensaje.idMensaje)) {
      res.status(200).json({ ok: true, duplicado: true });
      return;
    }

    const historial = await obtenerHistorial(db, mensaje.waId);

    const conversacion = [
      ...historial,
      { role: "user", content: mensaje.texto },
    ];

    const response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      output_config: { effort: "low" },
      messages: conversacion,
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const respuesta =
      response.stop_reason === "refusal"
        ? "No puedo responder a eso. ¿Quieres que te conecte con el equipo de Qi-Vanta?"
        : (textBlock ? textBlock.text : "Disculpa, no pude generar una respuesta. ¿Puedes reformular tu pregunta?");

    await enviarRespuestaWati(mensaje.waId, respuesta);

    await guardarHistorial(db, mensaje.waId, [
      ...conversacion,
      { role: "assistant", content: respuesta },
    ]);

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Error en wati-webhook:", err);
    // Responder 200 para que WATI no reintente en bucle un mensaje que ya falló.
    res.status(200).json({ ok: false, error: err.message });
  }
};

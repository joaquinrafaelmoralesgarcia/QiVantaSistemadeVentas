const { chatCompletionText } = require("./_deepinfraClient");
const { SYSTEM_PROMPT, PLAIN_TEXT_FORMAT_SUFFIX } = require("./_systemPrompt");
const { getDb } = require("./_mongo");
const { aplicarCors } = require("./_cors");

async function guardarConversacionWeb(sessionId, conversation, reply) {
  try {
    const db = await getDb();
    await db.collection("widget_conversaciones").updateOne(
      { sessionId },
      {
        $set: {
          sessionId,
          mensajes: [...conversation, { role: "assistant", content: reply }].slice(-16),
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );
  } catch (err) {
    // No debe romper la respuesta al usuario si falla el guardado del historial
    console.error("Error guardando conversación web:", err);
  }
}

module.exports = async function handler(req, res) {
  if (aplicarCors(req, res)) return;

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!process.env.DEEPINFRA_API_KEY) {
    res.status(500).json({ error: "El servidor no tiene configurada la clave de DeepInfra (DEEPINFRA_API_KEY)." });
    return;
  }

  try {
    const { messages, sessionId } = req.body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "Falta el arreglo 'messages'." });
      return;
    }

    // Limita el historial para controlar costo/latencia
    const conversation = messages.slice(-16).map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || "").slice(0, 4000),
    }));

    let reply;
    try {
      reply = await chatCompletionText({
        system: SYSTEM_PROMPT + PLAIN_TEXT_FORMAT_SUFFIX,
        messages: conversation,
        maxTokens: 700,
      });
    } catch (err) {
      console.error("Error generando respuesta con DeepInfra:", err.message);
      reply = "Disculpa, no pude generar una respuesta. ¿Puedes reformular tu pregunta?";
    }

    if (sessionId) await guardarConversacionWeb(sessionId, conversation, reply);
    res.status(200).json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ocurrió un error al contactar al asistente." });
  }
};

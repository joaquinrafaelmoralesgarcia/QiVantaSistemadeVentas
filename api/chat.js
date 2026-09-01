const Anthropic = require("@anthropic-ai/sdk");
const { SYSTEM_PROMPT } = require("./_systemPrompt");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "El servidor no tiene configurada la clave de Anthropic (ANTHROPIC_API_KEY)." });
    return;
  }

  try {
    const { messages } = req.body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "Falta el arreglo 'messages'." });
      return;
    }

    // Limita el historial para controlar costo/latencia
    const conversation = messages.slice(-16).map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || "").slice(0, 4000),
    }));

    const response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      output_config: { effort: "low" },
      messages: conversation,
    });

    if (response.stop_reason === "refusal") {
      res.status(200).json({
        reply: "No puedo responder a esa solicitud. ¿Quieres que te conecte con el equipo de Qi-Vanta?",
      });
      return;
    }

    const textBlock = response.content.find((b) => b.type === "text");
    res.status(200).json({ reply: textBlock ? textBlock.text : "" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ocurrió un error al contactar al asistente." });
  }
};

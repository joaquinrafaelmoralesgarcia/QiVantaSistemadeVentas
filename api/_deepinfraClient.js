// Cliente para DeepInfra (endpoint OpenAI-compatible), usado SOLO por el
// flujo de prospección (_leadScript.js) para dejar de depender de saldo de
// Anthropic en esa tarea. El chat en vivo de qi-vanta.com y WhatsApp
// (chat.js / wati-webhook.js) sigue en Claude — no tocar eso aquí.
//
// Qwen3.5-9B trae "thinking" activado por default: sin chat_template_kwargs
// enable_thinking:false, el modelo gasta todo max_tokens razonando en inglés
// y nunca llega a escribir el JSON final (finish_reason "length", content
// vacío) — verificado el 2026-09-03 con una llamada real.
const DEEPINFRA_BASE_URL = "https://api.deepinfra.com/v1/openai/chat/completions";
const MODEL = "Qwen/Qwen3.5-9B";

async function llamarDeepInfra(body) {
  const res = await fetch(DEEPINFRA_BASE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.DEEPINFRA_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      chat_template_kwargs: { enable_thinking: false },
      ...body,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`DeepInfra respondió con error (${res.status}): ${data?.error?.message || JSON.stringify(data)}`);
  }
  return data;
}

async function chatCompletionJSON({ system, user, maxTokens = 800, temperature = 0.7 }) {
  const data = await llamarDeepInfra({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    max_tokens: maxTokens,
    temperature,
  });

  const texto = data.choices?.[0]?.message?.content;
  if (!texto) throw new Error("DeepInfra no devolvió contenido (respuesta vacía)");
  return JSON.parse(texto);
}

// Para conversación libre (chat en vivo) — sin response_format json_object,
// recibe el historial completo de turnos [{role, content}, ...].
async function chatCompletionText({ system, messages, maxTokens = 700, temperature = 0.7 }) {
  const data = await llamarDeepInfra({
    messages: [{ role: "system", content: system }, ...messages],
    max_tokens: maxTokens,
    temperature,
  });

  const texto = data.choices?.[0]?.message?.content;
  if (!texto) throw new Error("DeepInfra no devolvió contenido (respuesta vacía)");
  return texto;
}

module.exports = { chatCompletionJSON, chatCompletionText };

// Cliente compartido para DeepInfra (endpoint OpenAI-compatible), usado por
// los 3 flujos que antes dependían de saldo de Anthropic: prospección
// (_leadScript.js), WhatsApp (wati-webhook.js) y el widget web (chat.js).
//
// Modelo elegido tras comparar 3 opciones el 2026-09-03 con los prompts
// reales del proyecto (4 negocios + 4 escenarios de chat en paralelo):
// Mistral-Small-3.2-24B ganó en todo — JSON 100% válido, 3-6x más rápido
// (1-3.5s vs 8-22s) y mismo costo o menor que Qwen3.5-9B. Llama-3.3-70B
// quedó descartado: pese a ser "más grande", envolvía el JSON en ```json
// pese a la instrucción explícita de no hacerlo.
//
// chat_template_kwargs.enable_thinking:false se deja siempre presente aunque
// Mistral no lo necesite (no le hace daño, verificado) — es la protección
// contra el bug real que sí tuvo Qwen3.5-9B: sin ese flag, gastaba todo
// max_tokens "pensando" en inglés y nunca escribía el JSON final. Si el
// modelo vuelve a cambiar a uno con "thinking", este flag ya está puesto.
const DEEPINFRA_BASE_URL = "https://api.deepinfra.com/v1/openai/chat/completions";
const MODEL = "mistralai/Mistral-Small-3.2-24B-Instruct-2506";

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

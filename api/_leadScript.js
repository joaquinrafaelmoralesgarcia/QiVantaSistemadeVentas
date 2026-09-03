const { chatCompletionJSON } = require("./_deepinfraClient");
const { PROSPECTING_SYSTEM_PROMPT } = require("./_prospectingPrompt");

// DeepInfra (Qwen3.5-9B) no soporta el modo estricto output_config/json_schema
// de Anthropic — en vez de eso, el formato exacto se exige por instrucción de
// texto (verificado el 2026-09-03: sin "no agregues clave adicional" el
// modelo a veces mete una clave "firma" suelta además de cuerpoEmail).
const JSON_INSTRUCTIONS = `

Responde ÚNICAMENTE con un objeto JSON válido (sin markdown, sin \`\`\`, sin texto fuera del JSON), con exactamente estas 5 claves:
{
  "calificacion": "alta" | "media" | "baja" (qué tan buen prospecto es: alta si claramente necesita automatización/IA y parece tener presupuesto, baja si no aplica bien),
  "razonamiento": "1 frase interna explicando la calificación, no se envía al lead, es para el vendedor",
  "mensajeWhatsapp": "mensaje corto, máx 350 caracteres, tono cercano y directo en español de México, cierra con pregunta abierta",
  "asuntoEmail": "asunto corto, máx 60 caracteres, específico al negocio, sin sonar a plantilla",
  "cuerpoEmail": "correo frío completo, 3-5 frases cortas, sin HTML, firma como 'Equipo Qi-Vanta' (la firma va DENTRO de este texto, no como clave aparte)"
}
No agregues ninguna clave adicional fuera de esas 5.`;

async function generarScript(negocio) {
  const detalles = [
    `Nombre: ${negocio.nombre}`,
    `Categoría: ${negocio.categoria || "desconocida"}`,
    `¿Tiene sitio web?: ${negocio.tieneSitioWeb ? `Sí (${negocio.sitioWeb})` : "No"}`,
    negocio.calificacionGoogle ? `Calificación en Google: ${negocio.calificacionGoogle} (${negocio.numResenas || 0} reseñas)` : null,
    `Dirección: ${negocio.direccion || "desconocida"}`,
  ]
    .filter(Boolean)
    .join("\n");

  return chatCompletionJSON({
    system: PROSPECTING_SYSTEM_PROMPT + JSON_INSTRUCTIONS,
    user: `Con estos datos públicos de un negocio, genera el mensaje de primer contacto (nunca inventes datos que no te dieron):\n\n${detalles}`,
    maxTokens: 800,
  });
}

module.exports = { generarScript };

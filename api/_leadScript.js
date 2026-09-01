const { client } = require("./_anthropicClient");

const SCHEMA = {
  type: "object",
  properties: {
    calificacion: {
      type: "string",
      enum: ["alta", "media", "baja"],
      description: "Qué tan buen prospecto es para Qi-Vanta: alta si claramente necesita automatización/IA y parece tener presupuesto, baja si no aplica bien.",
    },
    razonamiento: {
      type: "string",
      description: "1 frase interna explicando la calificación (no se envía al lead, es para el vendedor).",
    },
    mensajeWhatsapp: {
      type: "string",
      description: "Mensaje corto (máx. 350 caracteres), tono cercano y directo en español de México, mencionando algo específico y observable del negocio (ej. que no tiene sitio web, o que su sitio es básico) y proponiendo un agente de IA de Qi-Vanta que atienda clientes 24/7 por WhatsApp. Termina con una pregunta abierta e invitación a platicar. No suena a plantilla genérica ni a spam masivo.",
    },
    iceBreakerEmail: {
      type: "string",
      description: "1-2 frases en español para usar como primera línea personalizada de un correo frío (el resto del correo ya está en una secuencia predefinida de Smartlead). Debe mencionar algo específico y observable del negocio.",
    },
  },
  required: ["calificacion", "razonamiento", "mensajeWhatsapp", "iceBreakerEmail"],
  additionalProperties: false,
};

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

  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 600,
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: `Eres un asistente de prospección comercial para Qi-Vanta (consultoría de automatización e IA empresarial: SDLC inteligente, RPA+IA, modernización legacy, DevSecOps, copilotos, RAG/analítica). Con estos datos públicos de un negocio, genera un mensaje de primer contacto personalizado y honesto (nunca inventes datos que no te dieron):\n\n${detalles}`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) return null;
  return JSON.parse(textBlock.text);
}

module.exports = { generarScript };

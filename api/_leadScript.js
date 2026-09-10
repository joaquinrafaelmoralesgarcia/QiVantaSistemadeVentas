const { chatCompletionJSON } = require("./_deepinfraClient");
const { PROSPECTING_SYSTEM_PROMPT } = require("./_prospectingPrompt");
const { construirPromptEmpresa } = require("./_prospectingPromptEnterprise");

// Compartida entre PYME (Google Maps) y empresa (Piloto LATAM) — pedido
// explícito del usuario el 2026-09-04.
const REGLA_ASUNTO_DINERO =
  "DEBE mencionar dinero explícitamente (la palabra 'dinero', 'cuesta', '$', 'gastan' o similar) — nunca preguntes solo por cantidad de clientes/citas/cotizaciones perdidas sin ponerle el enfoque de costo en pesos. Estilo obligatorio: '¿Cuánto dinero estás perdiendo por [problema específico observable]?' o '¿Cuánto dinero dejas de ganar por no tener [solución]?' o '¿Sabes cuánto te cuesta [problema] al mes?' — SIEMPRE atado al problema concreto de ESE negocio/empresa, nunca genérico ni igual entre leads distintos. IMPORTANTE: el enfoque de dinero es una PREGUNTA retórica, nunca una cifra inventada — jamás pongas un monto específico ($5,000, 30%, etc.) que no te dieron, eso es mentir con datos falsos.";

// Seguimiento agregado el 2026-09-05: ninguna de las 2 campañas tenía más
// que un solo correo (sequence_count:1) — con Google Maps en 0 respuestas
// de 162 enviados, la mejora de más impacto disponible es dar seguimiento,
// no seguir puliendo el correo inicial. Se generan junto con el correo
// principal para que puedan referenciar el mismo gancho/oferta sin
// repetirlo completo.
const REGLA_SEGUIMIENTOS =
  '"seguimiento1": "correo de seguimiento corto (2-3 frases), se manda si no responden al día 3. Referencia brevemente (sin repetirla completa) la oferta/gancho del correo original, tono ligero tipo \'sigo al pendiente de tu respuesta sobre...\' — nunca inventes cifras ni casos de éxito nuevos. Sin firma/despedida, se agrega después.", "seguimiento2": "correo de seguimiento final, aún más corto (1-2 frases), se manda si no responden al día 7. Tono de última oportunidad sin presionar, estilo \'no quiero ser insistente, este es mi último mensaje por ahora, quedo atento si más adelante te interesa platicar\'. Sin firma/despedida, se agrega después."';

// DeepInfra (Qwen3.5-9B) no soporta el modo estricto output_config/json_schema
// de Anthropic — en vez de eso, el formato exacto se exige por instrucción de
// texto (verificado el 2026-09-03: sin "no agregues clave adicional" el
// modelo a veces mete una clave "firma" suelta además de cuerpoEmail).
const JSON_INSTRUCTIONS = `

Responde ÚNICAMENTE con un objeto JSON válido (sin markdown, sin \`\`\`, sin texto fuera del JSON), con exactamente estas 7 claves:
{
  "calificacion": "alta" | "media" | "baja" (qué tan buen prospecto es: alta si claramente necesita automatización/IA y parece tener presupuesto, baja si no aplica bien),
  "razonamiento": "1 frase interna explicando la calificación, no se envía al lead, es para el vendedor",
  "mensajeWhatsapp": "mensaje corto, máx 280 caracteres, tono cercano y directo en español de México, cierra con pregunta abierta. Nunca escribas placeholders entre corchetes como [Nombre] — no sabes el nombre de quien lee, dirígete directo al negocio o usa un saludo genérico ('Hola,'). NO incluyas firma ni datos de contacto, se agregan automáticamente después",
  "asuntoEmail": "asunto corto, máx 60 caracteres. ${REGLA_ASUNTO_DINERO}",
  "cuerpoEmail": "correo frío completo, 3-5 frases cortas, sin HTML. Igual que el asunto, el cuerpo también debe reforzar el enfoque de dinero perdido/dejado de ganar por el problema detectado — no basta con mencionarlo solo en el asunto, dedica al menos 1 frase del cuerpo a plantear el costo en dinero de NO resolver ese problema (ej. 'cada cliente que se va sin cotización es dinero que ya gastaste en atraerlo'), antes de presentar la oferta como la solución a esa pérdida. NUNCA inventes una cifra específica ($5,000, 30%, 'ahorra X pesos') ni afirmes resultados con otros clientes ('hemos ayudado a empresas a lograr...') que no puedas verificar — el enfoque de dinero se queda en pregunta retórica o concepto, jamás en un número o caso de éxito inventado. No te presentes por nombre en ningún punto del texto (ni al inicio ni al final) — nunca escribas 'me llamo...' ni placeholders entre corchetes como [Nombre]. No incluyas firma, despedida ('Saludos', 'Equipo Qi-Vanta') ni datos de contacto — todo eso se agrega automáticamente después, fuera de este texto. Empieza directo con el gancho sobre el negocio, sigue con el costo en dinero de no resolverlo, presenta la oferta, y termina en la pregunta/invitación a platicar",
  ${REGLA_SEGUIMIENTOS}
}
No agregues ninguna clave adicional fuera de esas 7.`;

// Se agrega en código, no se le pide al modelo que la escriba (riesgo de que
// invente o altere el correo/nombre real) — pedido explícito del usuario el
// 2026-09-03: los mensajes no traían forma de verificar que Qi-Vanta es real.
const FIRMA_WHATSAPP = `

— Joaquín Morales | Qi-Vanta
https://www.qi-vanta.com`;

// NUNCA se le pega a cuerpoEmail/seguimientos — a diferencia de WhatsApp
// (que no tiene firma de plataforma), Smartlead SÍ agrega su propia firma
// de cuenta automáticamente al final de cada correo enviado (verificado el
// 2026-09-08: las 6 cuentas de envío ya la tienen configurada). Pegar esto
// en el texto además de eso duplicaba la firma — confirmado con un correo
// real ya enviado que mostraba "Joaquin Morales... Qi-Vanta" dos veces
// seguidas. Se deja declarada solo por si algún día se necesita en un
// canal sin firma de plataforma propia.
const FIRMA_EMAIL = `

Joaquín Morales
Strategic Transformation Advisor | Qi-Vanta
AI-Native SDLC & Automatización
https://www.qi-vanta.com
joaquin.morales@qi-vantatech.com`;

// Frase fija que debe ir en TODOS los correos de la campaña de Apify/Google
// Maps, sin importar qué oferta haya elegido el modelo — pedido explícito
// del usuario el 2026-09-04. Se agrega en código (no se le pide al modelo
// que la redacte) para que el texto salga siempre idéntico.
const LINEA_VOZ_IA = "Adicionamos Chatbots impulsados con voz natural con IA, inteligencia para las respuestas de tu negocio.";

// Solo para la campaña "Piloto LATAM | Decisores" (empresas medianas/
// grandes, no los negocios chicos de Google Maps) — pedido explícito del
// usuario el 2026-09-04: "en la de piloto latam mencionar todo lo que te
// puse mas opex y en google maps va sin opex pero si todo lo demas".
const OPEX_SUFFIX = `

TEMA ADICIONAL OBLIGATORIO PARA ESTE CORREO (empresa mediana/grande, campaña Piloto LATAM): además de la oferta del Paso 2, menciona brevemente cómo Qi-Vanta ayuda a reducir costos de OPEX (gastos operativos) con automatización — por ejemplo, menos horas-persona en tareas repetitivas, menos retrabajo/errores, procesos que antes necesitaban más personal ahora corren solos. No lo conviertas en el tema principal del correo, es un argumento adicional que refuerza el ROI junto a la oferta ya elegida.`;

// Piloto LATAM es 100% correo (contactos corporativos vía LinkedIn/base de
// datos, sin teléfono/WhatsApp) — a diferencia de generarScript() no incluye
// mensajeWhatsapp ni PASO 1 de negocio local, usa su propio prompt de tono
// consultivo-empresarial (ver _prospectingPromptEnterprise.js).
const JSON_INSTRUCTIONS_EMPRESA = `

Responde ÚNICAMENTE con un objeto JSON válido (sin markdown, sin \`\`\`, sin texto fuera del JSON), con exactamente estas 7 claves:
{
  "calificacion": "alta" | "media" | "baja" (qué tan buen prospecto es: alta si claramente necesita automatización/IA y parece tener presupuesto/tamaño para invertir, baja si no aplica bien),
  "razonamiento": "1 frase interna explicando la calificación, no se envía al lead, es para el vendedor",
  "oferta": "el id exacto de la oferta elegida del menú (ej. 'data_analytics', 'enterprise_automation')",
  "asuntoEmail": "asunto corto, máx 60 caracteres. ${REGLA_ASUNTO_DINERO}",
  "cuerpoEmail": "correo completo siguiendo la estructura de 5 pasos del prompt (saludo con nombre, gancho real sobre la empresa, reto plausible en tono hedgeado, oferta elegida, cierre invitando a 15-20 min esta semana), sin HTML. NUNCA inventes una cifra específica ($, %, ahorro en dinero) ni afirmes resultados con otros clientes ('hemos ayudado a bancos a lograr X%', 'nuestros clientes ahorran Y') que no puedas verificar — eso es mentir con datos y casos de éxito falsos a un tomador de decisión real. El enfoque de dinero/OPEX se queda en pregunta retórica o concepto, nunca en un número o cliente inventado. No te presentes por nombre en ningún punto del texto — nunca escribas 'me llamo...' ni placeholders entre corchetes. No incluyas firma ni despedida — se agrega automáticamente después, fuera de este texto",
  ${REGLA_SEGUIMIENTOS}
}
No agregues ninguna clave adicional fuera de esas 7.`;

async function generarScriptEmpresa(lead) {
  const detalles = [
    `Nombre del contacto: ${lead.nombre}`,
    `Puesto: ${lead.titulo || "desconocido"}`,
    `Empresa: ${lead.empresa}`,
    typeof lead.numEmpleados === "number" ? `Número de empleados: ${lead.numEmpleados}` : null,
    lead.descripcionEmpresa ? `Qué hace la empresa (descripción disponible): ${lead.descripcionEmpresa}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const script = await chatCompletionJSON({
    system: construirPromptEmpresa(lead.numEmpleados) + JSON_INSTRUCTIONS_EMPRESA + OPEX_SUFFIX,
    user: `Con estos datos públicos de una empresa y su contacto, genera el correo de primer contacto (nunca inventes datos que no te dieron):\n\n${detalles}`,
    maxTokens: 1300,
  });

  // LINEA_VOZ_IA ("Adicionamos Chatbots...") es exclusiva de Google Maps/
  // Apify (ver su comentario arriba) — NO va aquí. Se agregaba por error en
  // todo correo de Piloto LATAM hasta el 2026-09-10, incluyendo a empresas
  // de miles de empleados, contradiciendo la oferta consultiva ya elegida.
  if (script.seguimiento1) script.seguimiento1 = script.seguimiento1.trim();
  if (script.seguimiento2) script.seguimiento2 = script.seguimiento2.trim();
  return script;
}

// Google Maps (PYME) nunca incluye el tema de OPEX — pedido explícito del
// usuario el 2026-09-04, ese tema es exclusivo de generarScriptEmpresa().
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

  const script = await chatCompletionJSON({
    system: PROSPECTING_SYSTEM_PROMPT + JSON_INSTRUCTIONS,
    user: `Con estos datos públicos de un negocio, genera el mensaje de primer contacto (nunca inventes datos que no te dieron):\n\n${detalles}`,
    maxTokens: 1200,
  });

  if (script.mensajeWhatsapp) script.mensajeWhatsapp += FIRMA_WHATSAPP;
  if (script.cuerpoEmail) script.cuerpoEmail = script.cuerpoEmail.trim() + `\n\n${LINEA_VOZ_IA}`;
  if (script.seguimiento1) script.seguimiento1 = script.seguimiento1.trim();
  if (script.seguimiento2) script.seguimiento2 = script.seguimiento2.trim();
  return script;
}

// Para leads que YA se mandaron a Smartlead antes de que existiera el
// seguimiento (2026-09-05) — genera solo los 2 seguimientos a partir del
// correo que ya se envió, en vez de regenerar todo desde cero (evitaría
// que el 2do intento elija una oferta/gancho distinta a la ya enviada,
// dejando los seguimientos inconsistentes con el correo 1 real).
const JSON_INSTRUCTIONS_SOLO_SEGUIMIENTOS = `

Ya se mandó un correo inicial (te lo doy abajo, ya con firma incluida — ignora la firma, solo úsalo como contexto). Genera SOLO los 2 seguimientos para ese mismo correo, refiriéndote a su gancho/oferta sin repetirlo completo. Responde ÚNICAMENTE con un objeto JSON válido (sin markdown, sin \`\`\`) con exactamente estas 2 claves:
{
  ${REGLA_SEGUIMIENTOS}
}
No agregues ninguna clave adicional fuera de esas 2.`;

async function generarSeguimientos(cuerpoEmailOriginal, { esEmpresa = false } = {}) {
  const promptBase = esEmpresa ? construirPromptEmpresa(null) : PROSPECTING_SYSTEM_PROMPT;
  const script = await chatCompletionJSON({
    system: promptBase + JSON_INSTRUCTIONS_SOLO_SEGUIMIENTOS,
    user: `Correo inicial ya enviado:\n\n${cuerpoEmailOriginal}`,
    maxTokens: 500,
  });
  if (script.seguimiento1) script.seguimiento1 = script.seguimiento1.trim();
  if (script.seguimiento2) script.seguimiento2 = script.seguimiento2.trim();
  return script;
}

module.exports = { generarScript, generarScriptEmpresa, generarSeguimientos };

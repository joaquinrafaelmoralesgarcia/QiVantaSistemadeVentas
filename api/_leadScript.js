const { chatCompletionJSON } = require("./_deepinfraClient");
const { PROSPECTING_SYSTEM_PROMPT } = require("./_prospectingPrompt");
const { construirPromptEmpresa } = require("./_prospectingPromptEnterprise");
const { PROSPECTING_SYSTEM_PROMPT_GRANDE_GM } = require("./_prospectingPromptGrandeGoogleMaps");

// Compartida entre PYME (Google Maps) y empresa (Piloto LATAM) — pedido
// explícito del usuario el 2026-09-04, ampliado el 2026-09-10 con un banco
// real de frases de venta que el usuario pidió aplicar a los asuntos:
// "analiza cual aplica en cada empresa negocio o cliente de acuerdo a lo
// que mejor le ajusta de acuerdo al analisis que hace el sistema" — no es
// elegir una frase al azar, es que el propio análisis del Paso 1 (tamaño,
// sector, reto plausible) decida qué FAMILIA de tono encaja mejor con
// cada lead, y de ahí adapte una frase concreta, nunca la misma para
// todos. Reemplaza la regla anterior de "siempre debe ser pregunta" —
// varias de estas frases son afirmaciones directas, igual de válidas.
const REGLA_ASUNTO_DINERO = `DEBE mencionar dinero/costo explícitamente (la palabra "dinero", "cuesta", "gastas", "pagas", "ahorro", "margen" o similar) — nunca un asunto genérico sin ese enfoque. Elige la FAMILIA de tono que mejor encaje con el negocio/empresa según tu propio análisis del Paso 1 (no siempre la misma familia, varía entre leads distintos):

1. AHORRO DIRECTO — cuando el argumento más fuerte es reducir costo operativo (operación con procesos manuales pesados, backoffice, tareas repetitivas): "Te ayudamos a gastar menos haciendo lo mismo, pero más rápido" / "Donde hoy pagas horas hombre, nosotros ponemos automatización" / "Si un proceso te cuesta todos los meses, ahí hay oportunidad de ahorro" / "Menos operación manual, menos errores, menos gasto".
2. COMPARACIÓN CON COMPETENCIA — cuando el sector es competitivo/comoditizado y quedarse atrás es un riesgo real (retail, manufactura, servicios comerciales): "Tu competencia ya está automatizando; la pregunta es cuánto te está costando no hacerlo" / "Mientras otros reducen costos con IA, tú sigues pagando procesos manuales" / "Cada día que no automatizas, tu competencia gana margen".
3. CIERRE DE INTERÉS CONSULTIVO — buen default seguro cuando ninguna otra familia encaja con claridad: "Déjanos mostrarte dónde estás perdiendo dinero" / "Primero encontramos el ahorro, después vemos la solución" / "La propuesta empieza con números, no con promesas".
4. DIRECTA/COMERCIAL — para negocios con urgencia visible o cuando conviene un golpe de impacto corto (calificación alta): "El dinero se está yendo en tareas que una máquina ya puede hacer" / "Lo manual sale más caro de lo que parece" / "Cada Excel manual tiene un costo escondido".
5. VENTA CONSULTIVA — tono suave, funciona casi siempre, otro buen default: "Primero detectamos fugas de dinero; después automatizamos" / "Donde hay repetición, hay ahorro posible" / "La automatización no es gasto: es recuperación de dinero".

IMPORTANTE — las frases de arriba son solo EJEMPLOS de tono, NUNCA las copies textuales palabra por palabra: verificado el 2026-09-10 con una prueba real de 20 correos que, sin esta advertencia, el modelo repite "Donde hoy pagas horas hombre, nosotros ponemos automatización" IDÉNTICA en 9 de 20 empresas distintas — eso se ve como spam masivo, no personalización. Escribe SIEMPRE tu propia versión, inspirada en el tono de la familia elegida pero con palabras distintas y, cuando sea posible, referenciando algo concreto de ESE negocio específico (su sector, su tamaño, el reto plausible del Paso 1).

No copies una frase literal igual entre leads distintos — adáptala o combínala con el gancho/observación real de ESE negocio cuando sea posible. No tiene que ser pregunta, puede ser una afirmación directa como los ejemplos de arriba, siempre que mencione dinero/costo con una de las palabras de la lista (dinero, cuesta, gastas, pagas, ahorro, margen) — NO basta con "pierdes/perder" sola sin la palabra dinero, ej. MAL: "¿Cuánto pierdes al no tener X?" (no dice dinero) — BIEN: "¿Cuánto dinero pierdes al no tener X?". IMPORTANTE: jamás pongas un monto específico ($5,000, 30%, etc.) ni un resultado de otro cliente que no te dieron — el enfoque de dinero se queda en concepto/pregunta retórica, nunca en una cifra o caso de éxito inventado.`;

// Seguimiento agregado el 2026-09-05: ninguna de las 2 campañas tenía más
// que un solo correo (sequence_count:1) — con Google Maps en 0 respuestas
// de 162 enviados, la mejora de más impacto disponible es dar seguimiento,
// no seguir puliendo el correo inicial. Se generan junto con el correo
// principal para que puedan referenciar el mismo gancho/oferta sin
// repetirlo completo.
//
// Rediseñado el 2026-09-10 — pedido explícito del usuario: "el segundo
// correo debe enviarse a los 7 dias y luego a los 14 dias pero con titulo
// y contenido diferente esto aplica para las dos campañas". Antes eran
// respuestas cortas (2-3 frases) en el mismo hilo sin asunto propio,
// mandadas a los días 3 y 10 — ahora son correos completos con SU PROPIO
// asunto (mismo banco de frases de REGLA_ASUNTO_DINERO) y un ángulo
// genuinamente distinto al correo 1 y entre sí, mandados a los días 7 y
// 14 (el calendario de envío real vive en la secuencia de Smartlead, ver
// commit que actualiza seq_delay_details — aquí solo se genera el
// contenido).
const REGLA_SEGUIMIENTOS = `"seguimiento1Asunto": "asunto del correo de seguimiento del día 7 — DEBE ser distinto al asuntoEmail del correo 1 (no lo repitas ni lo parafrasees). ${REGLA_ASUNTO_DINERO}",
  "seguimiento1": "correo de seguimiento completo (3-4 frases, puede ser un párrafo corto), se manda 7 días después si no responden. NO es una nota corta tipo 'sigo al pendiente' — es un correo con su propio valor: retoma la conversación desde un ÁNGULO DISTINTO al correo 1 (ej. si el correo 1 usó el gancho de X reto operativo, este puede enfocarse en otro reto plausible, o en la misma oferta pero desde el ángulo de riesgo de no actuar, o en una oferta secundaria del mismo catálogo). Nunca inventes cifras ni casos de éxito nuevos. Sin firma/despedida ni saludo repetido tipo 'Hola [Nombre]' otra vez si ya se saludó en el correo 1 — puede abrir directo con el gancho nuevo.",
  "seguimiento2Asunto": "asunto del correo de seguimiento del día 14 — DEBE ser distinto a asuntoEmail Y a seguimiento1Asunto. ${REGLA_ASUNTO_DINERO}",
  "seguimiento2": "correo de seguimiento final completo (3-4 frases), se manda 14 días después si no responden. Último intento antes de dejar de insistir — ángulo distinto a los 2 correos anteriores (ej. cierre de baja presión tipo 'este es mi último mensaje por ahora' pero seguido de una razón concreta y nueva para platicar, no solo la despedida sola). Nunca inventes cifras ni casos de éxito nuevos. Sin firma/despedida."`;

// DeepInfra (Qwen3.5-9B) no soporta el modo estricto output_config/json_schema
// de Anthropic — en vez de eso, el formato exacto se exige por instrucción de
// texto (verificado el 2026-09-03: sin "no agregues clave adicional" el
// modelo a veces mete una clave "firma" suelta además de cuerpoEmail).
const JSON_INSTRUCTIONS = `

Responde ÚNICAMENTE con un objeto JSON válido (sin markdown, sin \`\`\`, sin texto fuera del JSON), con exactamente estas 9 claves:
{
  "calificacion": "alta" | "media" | "baja" (qué tan buen prospecto es: alta si claramente necesita automatización/IA y parece tener presupuesto, baja si no aplica bien),
  "razonamiento": "1 frase interna explicando la calificación, no se envía al lead, es para el vendedor",
  "mensajeWhatsapp": "mensaje corto, máx 280 caracteres, tono cercano y directo en español de México, cierra con pregunta abierta. Nunca escribas placeholders entre corchetes como [Nombre] — no sabes el nombre de quien lee, dirígete directo al negocio o usa un saludo genérico ('Hola,'). NO incluyas firma ni datos de contacto, se agregan automáticamente después",
  "asuntoEmail": "asunto corto, máx 60 caracteres. ${REGLA_ASUNTO_DINERO}",
  "cuerpoEmail": "correo frío completo, 3-5 frases cortas, sin HTML. Igual que el asunto, el cuerpo también debe reforzar el enfoque de dinero perdido/dejado de ganar por el problema detectado — no basta con mencionarlo solo en el asunto, dedica al menos 1 frase del cuerpo a plantear el costo en dinero de NO resolver ese problema (ej. 'cada cliente que se va sin cotización es dinero que ya gastaste en atraerlo'), antes de presentar la oferta como la solución a esa pérdida. NUNCA inventes una cifra específica ($5,000, 30%, 'ahorra X pesos') ni afirmes resultados con otros clientes ('hemos ayudado a empresas a lograr...') que no puedas verificar — el enfoque de dinero se queda en pregunta retórica o concepto, jamás en un número o caso de éxito inventado. No te presentes por nombre en ningún punto del texto (ni al inicio ni al final) — nunca escribas 'me llamo...' ni placeholders entre corchetes como [Nombre]. No incluyas firma, despedida ('Saludos', 'Equipo Qi-Vanta') ni datos de contacto — todo eso se agrega automáticamente después, fuera de este texto. Empieza directo con el gancho sobre el negocio, sigue con el costo en dinero de no resolverlo, presenta la oferta, y termina en la pregunta/invitación a platicar",
  ${REGLA_SEGUIMIENTOS}
}
No agregues ninguna clave adicional fuera de esas 9.`;

// Variante para Google Maps cuando _empresaGrande.js marca el negocio como
// probable cadena/empresa grande — igual que JSON_INSTRUCTIONS pero
// agrega "oferta" (id del catálogo enterprise elegido, para auditar cuál
// se usó) — pedido explícito del usuario el 2026-09-10.
const JSON_INSTRUCTIONS_GRANDE_GM = `

Responde ÚNICAMENTE con un objeto JSON válido (sin markdown, sin \`\`\`, sin texto fuera del JSON), con exactamente estas 10 claves:
{
  "calificacion": "alta" | "media" | "baja" (qué tan buen prospecto es: alta si claramente necesita automatización/IA y parece tener presupuesto, baja si no aplica bien),
  "razonamiento": "1 frase interna explicando la calificación, no se envía al lead, es para el vendedor",
  "oferta": "el id exacto de la oferta elegida del menú (ej. 'ai_native_sdlc', 'legacy_modernization')",
  "mensajeWhatsapp": "mensaje corto, máx 280 caracteres, tono cercano y directo en español de México, cierra con pregunta abierta. Nunca escribas placeholders entre corchetes como [Nombre] — no sabes el nombre de quien lee, dirígete directo al negocio o usa un saludo genérico ('Hola,'). NO incluyas firma ni datos de contacto, se agregan automáticamente después",
  "asuntoEmail": "asunto corto, máx 60 caracteres. ${REGLA_ASUNTO_DINERO}",
  "cuerpoEmail": "correo frío completo, 3-5 párrafos cortos, sin HTML. Igual que el asunto, el cuerpo también debe reforzar el enfoque de dinero perdido/dejado de ganar por el problema detectado. NUNCA inventes una cifra específica ni afirmes resultados con otros clientes que no puedas verificar. No te presentes por nombre en ningún punto del texto. No incluyas firma, despedida ni datos de contacto — se agrega automáticamente después. Empieza directo con el gancho sobre el negocio, sigue con el costo en dinero de no resolverlo, presenta la oferta, y termina en la pregunta/invitación a platicar",
  ${REGLA_SEGUIMIENTOS}
}
No agregues ninguna clave adicional fuera de esas 10.`;

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

Responde ÚNICAMENTE con un objeto JSON válido (sin markdown, sin \`\`\`, sin texto fuera del JSON), con exactamente estas 9 claves:
{
  "calificacion": "alta" | "media" | "baja" (qué tan buen prospecto es: alta si claramente necesita automatización/IA y parece tener presupuesto/tamaño para invertir, baja si no aplica bien),
  "razonamiento": "1 frase interna explicando la calificación, no se envía al lead, es para el vendedor",
  "oferta": "el id exacto de la oferta elegida del menú (ej. 'data_analytics', 'enterprise_automation')",
  "asuntoEmail": "asunto corto, máx 60 caracteres. ${REGLA_ASUNTO_DINERO}",
  "cuerpoEmail": "correo completo siguiendo la estructura de 5 pasos del prompt (saludo con nombre, gancho real sobre la empresa, reto plausible en tono hedgeado, oferta elegida, cierre invitando a 15-20 min esta semana), sin HTML. NUNCA inventes una cifra específica ($, %, ahorro en dinero) ni afirmes resultados con otros clientes ('hemos ayudado a bancos a lograr X%', 'nuestros clientes ahorran Y') que no puedas verificar — eso es mentir con datos y casos de éxito falsos a un tomador de decisión real. El enfoque de dinero/OPEX se queda en pregunta retórica o concepto, nunca en un número o cliente inventado. No te presentes por nombre en ningún punto del texto — nunca escribas 'me llamo...' ni placeholders entre corchetes. No incluyas firma ni despedida — se agrega automáticamente después, fuera de este texto",
  ${REGLA_SEGUIMIENTOS}
}
No agregues ninguna clave adicional fuera de esas 9.`;

// Validación real, no solo instrucción de prompt — verificado el
// 2026-09-10 con pruebas reales que el modelo (Qwen3.5-9B vía DeepInfra)
// no cumple de forma confiable la regla de "menciona dinero explícito" en
// los 3 asuntos a la vez (asuntoEmail, seguimiento1Asunto,
// seguimiento2Asunto) ni la de "tú, nunca su/usted" — se coló "su
// competencia" en una prueba real después de reforzar el prompt 2 veces.
// En vez de seguir puliendo el prompt sin garantía, se corrige en código:
// si algún asunto no trae palabra de dinero, se reescribe con una llamada
// puntual y barata (máx 60 tokens) que SOLO tiene esa tarea, mucho más
// confiable que pedirle 3 cosas distintas en la misma respuesta larga.
const PALABRAS_DINERO = /(dinero|cuesta|cuestan|gastas|gastan|pagas|pagan|pagar|ahorro|ahorras|margen|costo|costos)/i;
const PALABRAS_USTED = /\b(su|sus|suyo|suya|usted|ustedes)\b/i;

async function corregirAsunto(asuntoOriginal, contexto) {
  const problemas = [];
  if (!PALABRAS_DINERO.test(asuntoOriginal)) problemas.push("no menciona dinero/costo explícitamente (agrega una palabra como 'dinero', 'cuesta', 'gastas', 'ahorro', 'costo')");
  if (PALABRAS_USTED.test(asuntoOriginal)) problemas.push("usa 'su/usted' — debe ser 'tú/tu'");
  if (!problemas.length) return asuntoOriginal;

  try {
    const fix = await chatCompletionJSON({
      system: `Reescribes UNA línea de asunto de correo en español de México, corrigiendo SOLO estos problemas: ${problemas.join("; ")}. Mantén la misma idea/gancho del asunto original, cámbialo lo mínimo posible. Responde ÚNICAMENTE con JSON: {"asunto": "..."}`,
      user: `Asunto original: "${asuntoOriginal}"\nContexto: ${contexto}`,
      maxTokens: 60,
    });
    return fix?.asunto && PALABRAS_DINERO.test(fix.asunto) && !PALABRAS_USTED.test(fix.asunto) ? fix.asunto.trim() : asuntoOriginal;
  } catch (err) {
    console.error("Error corrigiendo asunto:", err.message);
    return asuntoOriginal;
  }
}

async function corregirAsuntosDelScript(script, contexto) {
  if (!script) return script;
  if (script.asuntoEmail) script.asuntoEmail = await corregirAsunto(script.asuntoEmail, contexto);
  if (script.seguimiento1Asunto) script.seguimiento1Asunto = await corregirAsunto(script.seguimiento1Asunto, contexto);
  if (script.seguimiento2Asunto) script.seguimiento2Asunto = await corregirAsunto(script.seguimiento2Asunto, contexto);
  return script;
}

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
    system: construirPromptEmpresa(lead.numEmpleados, { ofertasExcluidas: lead.ofertasExcluidas || [], esReciclaje: Boolean(lead.esReciclaje) }) + JSON_INSTRUCTIONS_EMPRESA + OPEX_SUFFIX,
    user: `Con estos datos públicos de una empresa y su contacto, genera el correo de ${lead.esReciclaje ? "reciclaje (otro servicio distinto, ver instrucciones)" : "primer contacto"} (nunca inventes datos que no te dieron):\n\n${detalles}`,
    maxTokens: 1900,
  });
  await corregirAsuntosDelScript(script, `Empresa: ${lead.empresa}, contacto: ${lead.nombre}`);

  // LINEA_VOZ_IA ("Adicionamos Chatbots...") es exclusiva de Google Maps/
  // Apify (ver su comentario arriba) — NO va aquí. Se agregaba por error en
  // todo correo de Piloto LATAM hasta el 2026-09-10, incluyendo a empresas
  // de miles de empleados, contradiciendo la oferta consultiva ya elegida.
  if (script.seguimiento1Asunto) script.seguimiento1Asunto = script.seguimiento1Asunto.trim();
  if (script.seguimiento1) script.seguimiento1 = script.seguimiento1.trim();
  if (script.seguimiento2Asunto) script.seguimiento2Asunto = script.seguimiento2Asunto.trim();
  if (script.seguimiento2) script.seguimiento2 = script.seguimiento2.trim();
  return script;
}

// Google Maps (PYME) nunca incluye el tema de OPEX — pedido explícito del
// usuario el 2026-09-04, ese tema es exclusivo de generarScriptEmpresa().
//
// Excepción: si _empresaGrande.js marcó el negocio como probable cadena/
// empresa grande (negocio.probablementeGrande), usa el catálogo enterprise
// en vez del catálogo PYME de 15 ofertas — pedido explícito del usuario el
// 2026-09-10, mismo criterio que ya aplica en Piloto LATAM. LINEA_VOZ_IA
// (línea fija de "chatbots con voz natural") tampoco se agrega en ese
// caso, es específica del catálogo PYME.
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

  const esGrande = Boolean(negocio.probablementeGrande);

  const script = await chatCompletionJSON({
    system: esGrande ? PROSPECTING_SYSTEM_PROMPT_GRANDE_GM + JSON_INSTRUCTIONS_GRANDE_GM : PROSPECTING_SYSTEM_PROMPT + JSON_INSTRUCTIONS,
    user: `Con estos datos públicos de un negocio, genera el mensaje de primer contacto (nunca inventes datos que no te dieron):\n\n${detalles}`,
    maxTokens: 1800,
  });
  await corregirAsuntosDelScript(script, `Negocio: ${negocio.nombre}, categoría: ${negocio.categoria || "desconocida"}`);

  if (script.mensajeWhatsapp) script.mensajeWhatsapp += FIRMA_WHATSAPP;
  if (script.cuerpoEmail) {
    script.cuerpoEmail = esGrande ? script.cuerpoEmail.trim() : script.cuerpoEmail.trim() + `\n\n${LINEA_VOZ_IA}`;
  }
  if (script.seguimiento1Asunto) script.seguimiento1Asunto = script.seguimiento1Asunto.trim();
  if (script.seguimiento1) script.seguimiento1 = script.seguimiento1.trim();
  if (script.seguimiento2Asunto) script.seguimiento2Asunto = script.seguimiento2Asunto.trim();
  if (script.seguimiento2) script.seguimiento2 = script.seguimiento2.trim();
  return script;
}

// Para leads que YA se mandaron a Smartlead antes de que existiera el
// seguimiento (2026-09-05) — genera solo los 2 seguimientos a partir del
// correo que ya se envió, en vez de regenerar todo desde cero (evitaría
// que el 2do intento elija una oferta/gancho distinta a la ya enviada,
// dejando los seguimientos inconsistentes con el correo 1 real).
const JSON_INSTRUCTIONS_SOLO_SEGUIMIENTOS = `

Ya se mandó un correo inicial (te lo doy abajo, ya con firma incluida — ignora la firma, solo úsalo como contexto). Genera SOLO los 2 seguimientos para ese mismo correo (día 7 y día 14), cada uno con su propio asunto y un ángulo distinto al correo original y entre sí — nunca repitas el gancho/oferta completo. Responde ÚNICAMENTE con un objeto JSON válido (sin markdown, sin \`\`\`) con exactamente estas 4 claves:
{
  ${REGLA_SEGUIMIENTOS}
}
No agregues ninguna clave adicional fuera de esas 4.`;

async function generarSeguimientos(cuerpoEmailOriginal, { esEmpresa = false } = {}) {
  const promptBase = esEmpresa ? construirPromptEmpresa(null) : PROSPECTING_SYSTEM_PROMPT;
  const script = await chatCompletionJSON({
    system: promptBase + JSON_INSTRUCTIONS_SOLO_SEGUIMIENTOS,
    user: `Correo inicial ya enviado:\n\n${cuerpoEmailOriginal}`,
    maxTokens: 700,
  });
  await corregirAsuntosDelScript(script, `Correo inicial ya enviado: ${cuerpoEmailOriginal.slice(0, 200)}`);
  if (script.seguimiento1Asunto) script.seguimiento1Asunto = script.seguimiento1Asunto.trim();
  if (script.seguimiento1) script.seguimiento1 = script.seguimiento1.trim();
  if (script.seguimiento2Asunto) script.seguimiento2Asunto = script.seguimiento2Asunto.trim();
  if (script.seguimiento2) script.seguimiento2 = script.seguimiento2.trim();
  return script;
}

module.exports = { generarScript, generarScriptEmpresa, generarSeguimientos };

// Análisis del sitio web real de la empresa, para anexar observaciones
// CONCRETAS al cuerpo del correo de Piloto LATAM — pedido explícito del
// usuario el 2026-09-26: "antes de enviar cada correo debes analizar esas
// debilidades como lo hicimos y anexarlas al cuerpo de correo, pero como
// adicional a lo que ya redactas".
//
// DISEÑO CLAVE — por qué el modelo NO escribe las observaciones:
// pedirle a un LLM "encuentra las debilidades de esta empresa" es un
// generador de alucinaciones (inventa "su sitio es lento", "les falta la
// certificación X"), y mandarle a un decisor una crítica FALSA de su
// propia empresa es peor que un correo genérico. Por eso aquí el modelo
// solo contesta preguntas de sí/no VERIFICABLES sobre el texto del sitio,
// y el texto que ve el lead sale de OBSERVACIONES, redactadas a mano.
// Misma filosofía que la validación de cifras/clientes inventados en
// _leadScript.js: la garantía vive en el código, no en el prompt.
//
// Si algo falla (sin sitio, fetch caído, timeout, JSON inválido), NO se
// agrega nada al correo — el correo sale igual que antes, sin bloquearse.
const { chatCompletionJSON } = require("./_deepinfraClient");

// Timeout corto a propósito: esto corre dentro del presupuesto de 60s de
// Vercel, que ya está ajustado (MAX_NUEVOS_POR_CORRIDA=2 por timeouts
// reales del 2026-09-11 y 2026-09-14). Si el sitio tarda, se abandona.
const TIMEOUT_FETCH_MS = 8000;
const MAX_CARACTERES_SITIO = 6000;

async function descargarSitio(url) {
  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), TIMEOUT_FETCH_MS);
  try {
    const res = await fetch(url, {
      signal: controlador.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; QiVantaBot/1.0)" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_CARACTERES_SITIO);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Solo preguntas de hecho, contestables leyendo el texto del sitio. Nada
// de juicios ("¿está bien diseñado?") ni de cosas no verificables desde
// el HTML ("¿son competitivos?").
const PREGUNTAS = `Vas a recibir el TEXTO PLANO del sitio web de una empresa. Contesta ÚNICAMENTE con un objeto JSON válido (sin markdown, sin \`\`\`) con exactamente estas 5 claves booleanas. Responde true solo si lo VES explícitamente en el texto; si tienes duda, responde false.
{
  "mencionaCertificaciones": true si el sitio menciona certificaciones, acreditaciones o normas (ISO, EMA, COFEPRIS, SOC 2, etc.),
  "mencionaTiemposDeEntrega": true si menciona tiempos de entrega, plazos de respuesta o SLA de su servicio,
  "mencionaCanalDigital": true si ofrece WhatsApp, chat en vivo, portal de clientes o app como canal de contacto,
  "mencionaCasosOClientes": true si muestra casos de éxito, clientes, testimonios o logos de clientes,
  "mencionaPreciosOPaquetes": true si publica precios, planes o paquetes
}
No agregues ninguna clave adicional.`;

// Frases redactadas a mano — el modelo NUNCA escribe esto. Tono de
// oportunidad, nunca de crítica: en un primer contacto en frío, señalarle
// defectos a un decisor genera rechazo defensivo (ver análisis real de
// Tamizajes de México, 2026-09-26).
const OBSERVACIONES = [
  { clave: "mencionaCertificaciones", texto: "no vi publicadas sus certificaciones o acreditaciones, que suelen ser lo primero que revisa un comprador institucional antes de adjudicar" },
  { clave: "mencionaTiemposDeEntrega", texto: "no encontré publicados sus tiempos de entrega o de respuesta, que en su sector suele ser un criterio de comparación directo" },
  { clave: "mencionaCanalDigital", texto: "no vi un canal digital de atención (WhatsApp, chat o portal), lo que deja toda la primera consulta dependiendo del teléfono y el correo" },
  { clave: "mencionaCasosOClientes", texto: "no vi casos o clientes publicados, desaprovechando la trayectoria que ya tienen como prueba social" },
];

// Máximo 2 observaciones por correo — una lista larga de "lo que te falta"
// se lee como auditoría no solicitada y mata la conversación.
const MAX_OBSERVACIONES = 2;

async function analizarSitio(url) {
  if (!url || typeof url !== "string") return null;
  const texto = await descargarSitio(url);
  if (!texto || texto.length < 200) return null; // sitio caído, vacío o puro JS

  try {
    return await chatCompletionJSON({
      system: PREGUNTAS,
      user: `Texto del sitio:\n\n${texto}`,
      maxTokens: 200,
    });
  } catch {
    return null;
  }
}

// Devuelve el bloque listo para anexar al cuerpo, o "" si no hay nada
// verificable que decir.
function lineaObservaciones(analisis) {
  if (!analisis || typeof analisis !== "object") return "";

  const encontradas = OBSERVACIONES.filter((o) => analisis[o.clave] === false)
    .slice(0, MAX_OBSERVACIONES)
    .map((o) => o.texto);

  if (!encontradas.length) return "";

  const cuerpo = encontradas.length === 1 ? encontradas[0] : `${encontradas[0]}, y ${encontradas[1]}`;
  return `Además, revisando su sitio: ${cuerpo}. Lo comento como oportunidad, no como crítica — son cosas que se resuelven rápido y suelen mover la aguja comercial.`;
}

module.exports = { analizarSitio, lineaObservaciones };

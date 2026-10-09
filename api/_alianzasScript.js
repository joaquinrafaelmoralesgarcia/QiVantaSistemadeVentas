// Campaña "Alianzas" (Smartlead id 3990563) — pedido explícito del usuario
// el 2026-09-20: a diferencia de Google Maps y Piloto LATAM (venderle
// directo a un negocio/empresa), esta campaña busca ALIANZAS con
// consultoras de tecnología/software/ERP/CRM que ya tienen su propia
// base de clientes empresariales — la propuesta es que Qi-Vanta entre
// como partner técnico de IA cuando su cliente lo necesite, sin competir
// por la relación comercial. El público objetivo son los 25-27 leads de
// Google Maps + Piloto LATAM identificados como empresas de tecnología
// (ver sesión del 2026-09-20) — de aquí en adelante, cualquier lead nuevo
// que caiga en ese perfil se manda aquí, no a las otras 2 campañas.
//
// A diferencia de generarScript()/generarScriptEmpresa() (que generan el
// correo completo con IA, personalizado por negocio), aquí el cuerpo es
// el texto EXACTO que dio el usuario — es una propuesta de partnership,
// no una venta consultiva por sector, así que no necesita el análisis de
// "Paso 1" por lead. Solo se personaliza el nombre y se rota el asunto.
const LINK_SERVICIOS = "https://negocios.qi-vanta.com/enterprise/";

// Fijo desde el 2026-09-21 — pedido explícito del usuario: "de ahora en
// adelante en esta campaña de alianza el titulo sera el mismo para
// todos". Antes rotaba entre 8 variantes; ya no.
const ASUNTO_ALIANZA_FIJO = "Hagamos una Alianza que no compite con tu negocio con Qi-Vanta";

// Fijos por el mismo pedido del 2026-09-22 (mismo título para todos) —
// antes rotaban entre 3 variantes cada uno.
const SEGUIMIENTO1_ASUNTO_FIJO = "¿Alguna oportunidad de IA que no estés cubriendo hoy?";
const SEGUIMIENTO2_ASUNTO_FIJO = "Último mensaje sobre la alianza";

// Saludo genérico fijo para todos — pedido explícito del usuario el
// 2026-09-22: "quiero el mismo titulo y cuerpo de correo para todos los
// correos de la campaña alianza". Antes insertaba el primer nombre
// cuando el lead traía contacto de persona (Piloto LATAM); ahora es
// "Hola," siempre, igual para los 37 leads (25 ya enviados + 12 nuevos)
// sin importar la fuente.
function saludo() {
  return "Hola,";
}

function generarCorreoAlianza(lead) {
  const saludoLead = saludo(lead);
  const asuntoEmail = ASUNTO_ALIANZA_FIJO;

  const cuerpoEmail = `${saludoLead}

Somos Qi-Vanta.

Estamos buscando generar alianzas con empresas de tecnología que ya atienden clientes empresariales y que están recibiendo solicitudes relacionadas con Inteligencia Artificial, automatización, agentes de IA o modernización tecnológica, pero cuyo foco principal está en otras especialidades.

La propuesta es sencilla: <strong>ustedes mantienen la relación y propiedad comercial con su cliente, y Qi-Vanta entra como partner tecnológico especializado cuando necesiten capacidades de IA.</strong>

Podemos trabajar bajo su marca, como partner visible o mediante un esquema de colaboración/comisión, dependiendo de cada oportunidad.

Actualmente podemos apoyarles en:

• Agentes y asistentes de IA
• Automatización inteligente de procesos
• RAG y búsqueda sobre información empresarial
• Integraciones de IA con ERP, CRM y sistemas internos
• Analítica, predicción y forecasting
• Modernización de aplicaciones legacy con IA
• AI-SDLC y automatización del desarrollo de software
• PoC y MVP de soluciones de IA
• Desarrollo de soluciones empresariales a la medida

Puedes ver el detalle de estos servicios aquí: <a href="${LINK_SERVICIOS}">${LINK_SERVICIOS}</a>

La idea no es competir por sus clientes, sino <strong>ampliar juntos el portafolio que pueden ofrecerles y generar nuevas oportunidades de negocio para ambas empresas</strong>.

${elegir(CTA_FINAL, (lead.correo || lead.empresa || lead.nombre || "") + ":cta")}`;

  const seguimiento1Asunto = SEGUIMIENTO1_ASUNTO_FIJO;
  const seguimiento1 = `${saludoLead} te escribí hace unos días sobre una posible alianza entre tu empresa y Qi-Vanta.

Para que sea más concreto: si hoy uno de tus clientes te pidiera un agente de IA, automatización de un proceso, o modernizar un sistema legacy con IA, y no es algo que manejen internamente — ahí es donde entraríamos nosotros, como partner técnico, sin tocar la relación comercial que ya tienen con ese cliente.

¿Tiene sentido platicarlo 15 minutos, o prefieres que te comparta un caso concreto primero?`;

  const seguimiento2Asunto = SEGUIMIENTO2_ASUNTO_FIJO;
  const seguimiento2 = `${saludoLead} este es mi último mensaje por ahora sobre la alianza — no quiero insistir de más.

Si más adelante te llega una solicitud de IA que no cubran internamente, con gusto lo platicamos en ese momento. Quedo abierto cuando te haga sentido.`;

  return { asuntoEmail, cuerpoEmail, seguimiento1Asunto, seguimiento1, seguimiento2Asunto, seguimiento2 };
}

// ---------------------------------------------------------------------------
// Version con IA (DeepInfra) — pedido explicito del usuario el 2026-10-07:
// "todos los copys obtenlos de deep infra segun el analisis que se haga de
// cada empresa". Sustituye a generarCorreoAlianza() como ruta por defecto.
//
// OJO con lo que NO cambia: esto sigue siendo una propuesta de ALIANZA, no
// una venta. No se reusa generarScriptEmpresa() justamente porque ese genera
// un pitch de venta consultiva, y mandarle eso a una consultora de
// tecnologia invierte la propuesta (pasarian de socio potencial a cliente
// potencial). Aqui la IA solo personaliza el gancho de entrada segun lo que
// la empresa realmente hace; el nucleo de la propuesta (ellos conservan la
// relacion comercial, Qi-Vanta entra como partner tecnico de IA) y el
// catalogo de servicios se mantienen como texto FIJO, para que la IA no
// pueda reformular ni inventar las condiciones de la alianza.
const { chatCompletionJSON } = require("./_deepinfraClient");
const { analizarSitio, lineaObservaciones } = require("./_analisisSitio");

// Variado por lead a proposito — pedido explicito del usuario el 2026-10-08:
// "cambia un poco lo mas parecido para que no salga como spam". El bloque
// anterior era UN SOLO texto fijo, byte-identico en los 166 correos que ya
// se generaron; eso es justo el patron que un filtro antispam detecta como
// envio masivo (incluso con el gancho de arriba personalizado, el 80% del
// cuerpo era literal igual). Las variantes de abajo dicen EXACTAMENTE lo
// mismo (mismas condiciones de la alianza, nunca se reformula el trato) con
// palabras distintas, y el orden de los bullets se mezcla por lead — asi
// cada correo es unico en texto plano aunque el mensaje sea el mismo.
//
// Seleccion DETERMINISTICA por correo (no aleatoria): regenerar el copy del
// mismo lead siempre da la misma variante, para no cambiarle el correo 1 a
// alguien que ya lo recibio si se vuelve a correr el generador.
function hashDeTexto(texto) {
  let h = 0;
  for (let i = 0; i < texto.length; i++) h = (h * 31 + texto.charCodeAt(i)) >>> 0;
  return h;
}
function elegir(opciones, semilla) {
  return opciones[hashDeTexto(semilla) % opciones.length];
}
function mezclarBullets(semilla) {
  const bullets = [
    "Agentes y asistentes de IA",
    "Automatización inteligente de procesos",
    "RAG y búsqueda sobre información empresarial",
    "Integraciones de IA con ERP, CRM y sistemas internos",
    "Analítica, predicción y forecasting",
    "Modernización de aplicaciones legacy con IA",
    "AI-SDLC y automatización del desarrollo de software",
    "PoC y MVP de soluciones de IA",
    "Desarrollo de soluciones empresariales a la medida",
  ];
  // Fisher-Yates con el hash de la semilla como fuente de "aleatoriedad"
  // reproducible — mismo lead siempre da el mismo orden.
  let h = hashDeTexto(semilla);
  const arr = [...bullets];
  for (let i = arr.length - 1; i > 0; i--) {
    h = (h * 1103515245 + 12345) >>> 0;
    const j = h % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.map((b) => `• ${b}`).join("\n");
}

const APERTURA_PROPUESTA = [
  "La propuesta es sencilla: <strong>ustedes mantienen la relación y propiedad comercial con su cliente, y Qi-Vanta entra como partner tecnológico especializado cuando necesiten capacidades de IA.</strong>",
  "Así de simple: <strong>el cliente sigue siendo suyo, con su marca y su relación comercial intacta; Qi-Vanta entra únicamente como partner técnico de IA cuando ustedes lo necesiten.</strong>",
  "La idea es directa: <strong>ustedes conservan la propiedad y la relación comercial del cliente, y Qi-Vanta aporta la capacidad técnica de IA que haga falta en cada caso.</strong>",
];
const MODALIDAD = [
  "Podemos trabajar bajo su marca, como partner visible o mediante un esquema de colaboración/comisión, dependiendo de cada oportunidad.",
  "El formato se ajusta a cada caso: trabajamos bajo su marca (white-label), como partner visible ante el cliente, o con un esquema de comisión por la oportunidad.",
  "Según convenga en cada proyecto, podemos operar bajo su marca, de forma visible como partner, o con un acuerdo de colaboración/comisión.",
];
const INTRO_SERVICIOS = [
  "Actualmente podemos apoyarles en:",
  "Hoy por hoy, estas son las áreas donde podemos sumar:",
  "Las capacidades que tenemos disponibles para una alianza incluyen:",
];
const VER_DETALLE = [
  (link) => `Puedes ver el detalle de estos servicios aquí: <a href="${link}">${link}</a>`,
  (link) => `El detalle completo de cada una está aquí: <a href="${link}">${link}</a>`,
  (link) => `Si quieres profundizar en alguna, el detalle está en: <a href="${link}">${link}</a>`,
];
const CTA_FINAL = [
  "Si actualmente tienen alguna oportunidad de IA que no estén cubriendo internamente, incluso podemos revisar un caso real juntos sin compromiso.\n\n¿Tendrías un espacio para explorar si existe posibilidad de colaboración?",
  "Si hoy tienen algún caso de IA que no cubran internamente, con gusto lo revisamos juntos, sin compromiso de ningún tipo.\n\n¿Te hace sentido platicar 15-20 minutos para ver si hay punto de colaboración?",
  "Si en este momento tienen una oportunidad de IA fuera de su foco, podemos revisarla juntos sin ningún compromiso.\n\n¿Tendría sentido explorar una posible colaboración?",
];
const CIERRE_PROPUESTA = [
  "La idea no es competir por sus clientes, sino <strong>ampliar juntos el portafolio que pueden ofrecerles y generar nuevas oportunidades de negocio para ambas empresas</strong>.",
  "No buscamos competir por su cliente: la meta es <strong>sumar capacidades al portafolio que ya le ofrecen, y abrir negocio nuevo para ambas partes</strong>.",
  "Nunca se trata de disputarles al cliente, sino de <strong>ampliar entre los dos lo que pueden ofrecerle, con oportunidades de negocio para ambas empresas</strong>.",
];

function nucleoAlianza(semilla) {
  // join("\n\n") ya separa cada elemento con una linea en blanco — sin "" de
  // relleno entre medio, que duplicaba los saltos (encontrado al probar con
  // leads reales: salian 3-4 lineas en blanco entre los bullets y el link).
  return [
    elegir(APERTURA_PROPUESTA, semilla + ":apertura"),
    elegir(MODALIDAD, semilla + ":modalidad"),
    elegir(INTRO_SERVICIOS, semilla + ":intro"),
    mezclarBullets(semilla + ":bullets"),
    elegir(VER_DETALLE, semilla + ":detalle")(LINK_SERVICIOS),
    elegir(CIERRE_PROPUESTA, semilla + ":cierre"),
  ].join("\n\n");
}

const PROMPT_ALIANZA = `Escribes correos en espanol para Qi-Vanta, una empresa de IA que busca ALIANZAS con empresas de tecnologia (consultoras de software, ERP, CRM, integradores) que ya atienden clientes empresariales.

El objetivo NO es venderle nada a la empresa que lee el correo. El objetivo es proponerle una alianza: ellos conservan a su cliente y Qi-Vanta entra como partner tecnico especializado cuando a su cliente le haga falta IA.

Reglas estrictas:
- Hablas de TU a la persona, en tono profesional y directo, sin exagerar ni adular.
- NUNCA inventes datos: ni cifras, ni casos de exito, ni nombres de clientes, ni tecnologias que la empresa use. Solo puedes referirte a lo que te doy en los datos.
- NUNCA propongas venderles un servicio para ellos mismos. Siempre es alianza para atender a SUS clientes.
- No escribas saludo ni firma ni despedida: eso se agrega aparte.
- No uses markdown ni vinetas en el gancho.`;

const JSON_ALIANZA = `

Responde UNICAMENTE con un objeto JSON valido (sin markdown) con exactamente estas 6 claves:
{
  "asuntoEmail": "asunto del correo 1, maximo 9 palabras, sobre la idea de alianza/colaboracion. Sin signos de admiracion.",
  "ganchoEmail": "2-3 frases que abren el correo 1. Conecta la especialidad REAL de la empresa (segun los datos que te di) con la idea de que a sus clientes les empiezan a pedir IA y eso no es su foco. Es el gancho de entrada, no la propuesta completa.",
  "seguimiento1Asunto": "asunto del seguimiento del dia 7, distinto al asuntoEmail, maximo 9 palabras.",
  "seguimiento1": "3-4 frases. Retoma la alianza desde un angulo distinto: plantea el caso concreto de que un cliente suyo pida IA y ellos no lo cubran internamente. Sin saludo.",
  "seguimiento2Asunto": "asunto del ultimo mensaje, distinto a los otros dos, maximo 9 palabras.",
  "seguimiento2": "2-3 frases de cierre cordial, sin insistir, dejando la puerta abierta. Sin saludo."
}
No agregues ninguna clave adicional.`;

async function generarCorreoAlianzaIA(lead) {
  const datos = [
    `Empresa: ${lead.empresa || lead.nombre}`,
    lead.titulo ? `Puesto del contacto: ${lead.titulo}` : null,
    typeof lead.numEmpleados === "number" ? `Numero de empleados: ${lead.numEmpleados}` : null,
    lead.descripcionEmpresa ? `Que hace la empresa: ${lead.descripcionEmpresa}` : null,
    lead.sitioWeb ? `Sitio web: ${lead.sitioWeb}` : null,
  ].filter(Boolean).join("\n");

  // El analisis del sitio corre en paralelo, igual que en generarScriptEmpresa:
  // si falla no tumba la generacion, solo no se anexan observaciones.
  const [script, analisis] = await Promise.all([
    chatCompletionJSON({
      system: PROMPT_ALIANZA + JSON_ALIANZA,
      user: `Con estos datos de una empresa de tecnologia y su contacto, genera el correo de propuesta de alianza (nunca inventes datos que no te dieron):\n\n${datos}`,
      maxTokens: 1100,
    }),
    analizarSitio(lead.sitioWeb).catch(() => null),
  ]);

  const observaciones = lineaObservaciones(analisis, lead.correo || lead.empresa || lead.nombre || "");
  const gancho = (script.ganchoEmail || "").trim();

  const cuerpoEmail = `${saludo(lead)}

Somos Qi-Vanta.

${gancho}

${nucleoAlianza(lead.correo || lead.empresa || lead.nombre || "")}${observaciones ? `\n\n${observaciones}` : ""}

Si actualmente tienen alguna oportunidad de IA que no estén cubriendo internamente, incluso podemos revisar un caso real juntos sin compromiso.

¿Tendrías un espacio para explorar si existe posibilidad de colaboración?`;

  return {
    asuntoEmail: (script.asuntoEmail || ASUNTO_ALIANZA_FIJO).trim(),
    cuerpoEmail,
    seguimiento1Asunto: (script.seguimiento1Asunto || SEGUIMIENTO1_ASUNTO_FIJO).trim(),
    seguimiento1: `${saludo(lead)}

${(script.seguimiento1 || "").trim()}`,
    seguimiento2Asunto: (script.seguimiento2Asunto || SEGUIMIENTO2_ASUNTO_FIJO).trim(),
    seguimiento2: `${saludo(lead)}

${(script.seguimiento2 || "").trim()}`,
  };
}

module.exports = { generarCorreoAlianza, generarCorreoAlianzaIA };


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

const SEGUIMIENTO1_ASUNTOS = [
  "¿Alguna oportunidad de IA que no estés cubriendo hoy?",
  "Retomando la propuesta de alianza",
  "Un ejemplo concreto de cómo trabajaríamos juntos",
];

const SEGUIMIENTO2_ASUNTOS = [
  "Último mensaje sobre la alianza",
  "Cierro el tema de la alianza por ahora",
  "Quedamos abiertos cuando te haga sentido",
];

// Rotación determinística por correo (no al azar en cada corrida) — así
// si algún día se re-genera el mismo lead, no cambia de asunto sin razón.
function elegirPorHash(lista, semilla) {
  let hash = 0;
  for (const c of semilla || "") hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return lista[hash % lista.length];
}

function primerNombre(nombreCompleto) {
  return (nombreCompleto || "").trim().split(/\s+/)[0] || "";
}

// Los leads de Google Maps de esta lista no tienen contacto real, solo el
// nombre del NEGOCIO ("Servicios Profesionales en Informática") — no un
// nombre de persona como los de Piloto LATAM ("Julio Milla Hernandez").
// Detectado el 2026-09-20 al ver que salía "Hola Servicios," con esos
// leads. esPersona (lo pasa el caller según origen: true para
// apollo_latam/clay_latam, false para Google Maps) decide si se usa el
// saludo con nombre o uno genérico — mismo criterio que ya usa
// mensajeWhatsapp en _prospectingPrompt.js para negocios sin contacto
// conocido.
function saludo(lead) {
  if (lead.esPersona === false) return "Hola,";
  const nombre = primerNombre(lead.nombre);
  return nombre ? `Hola ${nombre},` : "Hola,";
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

Si actualmente tienen alguna oportunidad de IA que no estén cubriendo internamente, incluso podemos revisar un caso real juntos sin compromiso.

¿Tendrías un espacio para explorar si existe posibilidad de colaboración?`;

  const seguimiento1Asunto = elegirPorHash(SEGUIMIENTO1_ASUNTOS, lead.correo + "1");
  const seguimiento1 = `${saludoLead} te escribí hace unos días sobre una posible alianza entre tu empresa y Qi-Vanta.

Para que sea más concreto: si hoy uno de tus clientes te pidiera un agente de IA, automatización de un proceso, o modernizar un sistema legacy con IA, y no es algo que manejen internamente — ahí es donde entraríamos nosotros, como partner técnico, sin tocar la relación comercial que ya tienen con ese cliente.

¿Tiene sentido platicarlo 15 minutos, o prefieres que te comparta un caso concreto primero?`;

  const seguimiento2Asunto = elegirPorHash(SEGUIMIENTO2_ASUNTOS, lead.correo + "2");
  const seguimiento2 = `${saludoLead} este es mi último mensaje por ahora sobre la alianza — no quiero insistir de más.

Si más adelante te llega una solicitud de IA que no cubran internamente, con gusto lo platicamos en ese momento. Quedo abierto cuando te haga sentido.`;

  return { asuntoEmail, cuerpoEmail, seguimiento1Asunto, seguimiento1, seguimiento2Asunto, seguimiento2 };
}

module.exports = { generarCorreoAlianza };

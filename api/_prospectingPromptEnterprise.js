// Prompt de prospección para la campaña "Piloto LATAM | Decisores" en
// Smartlead (id 3842244) — tomadores de decisión (CEOs, CIOs, fundadores,
// directores) de empresas medianas/grandes en Latinoamérica. Público
// completamente distinto al de _prospectingPrompt.js (que es para dueños
// de negocios chicos tipo estética/taller/veterinaria): aquí sí aplica
// vocabulario técnico-consultivo (IA, analítica predictiva, DevSecOps,
// gobierno de IA), porque es el día a día de esta audiencia.
//
// El tono, estructura y categorías de oferta de abajo se extrajeron
// analizando 100 leads reales ya enviados en esa campaña en agosto 2026
// (vía la API de Smartlead, campo custom_fields.qi_vanta_message) — pedido
// explícito del usuario el 2026-09-04: "debe ser una mezcla el mensaje y
// contenido con los mensajes que ya enviabas antes". Se mezcla ese estilo
// ya probado con las 2 piezas nuevas pedidas: asunto con enfoque de dinero
// perdido, y mención de reducción de costos de OPEX (ver OPEX_SUFFIX en
// _leadScript.js, que se le agrega aparte a este prompt).
//
// 2 catálogos, no 1 — pedido explícito del usuario el 2026-09-10: "no solo
// ofrecemos whatsapp o chatbots, recuerda que tienes que analizar que tipo
// de empresa es sobre todo arriba de 100 empleados tenemos otro tipo de
// servicios". Apollo trae el número REAL de empleados por lead
// (organization.estimated_num_employees, capturado en _apollo.js como
// numEmpleados) — no la banda de búsqueda (que puede ir hasta 3000). Con
// >=100 empleados casi siempre hay un área de TI/ingeniería real detrás,
// así que el catálogo cambia a temas de SDLC/DevSecOps/modernización en
// vez de automatización operativa genérica.
const UMBRAL_EMPRESA_GRANDE = 100;

const OFERTAS_EMPRESA_CHICA = [
  { id: "enterprise_automation", nombre: "Automatización empresarial", descripcion: "RPA + IA generativa para procesos de negocio repetitivos (workflows, análisis documental, atención) — reduce costos y libera tiempo de los equipos para decisiones estratégicas." },
  { id: "data_analytics", nombre: "Datos y analítica", descripcion: "Dashboards inteligentes, analítica predictiva y forecasting — convierte datos operativos en decisiones accionables en tiempo real, para anticipar demanda y priorizar recursos." },
  { id: "it_productivity", nombre: "Copilotos y productividad", descripcion: "Copilotos de IA para desarrollo, QA, DevOps y soporte — generan código, pruebas y documentación automáticamente, reducen onboarding y retrabajo, multiplican la capacidad del equipo." },
  { id: "devsecops_cybersecurity", nombre: "DevSecOps y ciberseguridad", descripcion: "Detección y remediación de vulnerabilidades, dependencias y malas prácticas asistida por IA dentro del propio ciclo de desarrollo, sin bloquear el delivery." },
  { id: "cx_contact_center", nombre: "Atención y contact center con IA", descripcion: "Agentes de IA (incluye voicebots y copilotos para agentes humanos) conectados a CRM para atención, soporte y seguimiento — reduce tiempos de respuesta y carga operativa." },
  { id: "sales_marketing_ai", nombre: "Ventas y marketing con IA", descripcion: "Priorización, seguimiento y personalización comercial con IA — lead scoring y automatización de CRM, reduce fuga de leads y mejora conversión." },
  { id: "ai_strategy_governance", nombre: "Estrategia y gobierno de IA", descripcion: "Define la estrategia de adopción de IA con gobierno, arquitectura y casos de uso priorizados por ROI — de concepto a resultados medibles, sin comprometer control ni compliance." },
];

// Empresas de 100+ empleados casi siempre tienen un área de TI/ingeniería
// propia — el ángulo relevante ya no es "te ponemos un chatbot", es
// acelerar y modernizar SU ciclo de desarrollo y su operación tecnológica.
const OFERTAS_EMPRESA_GRANDE = [
  { id: "ai_native_sdlc", nombre: "IA para SDLC / desarrollo de software", descripcion: "Generación automática de código, pruebas (unitarias y funcionales), documentación viva y copilotos para developers, QA y DevOps a lo largo de todo el ciclo de desarrollo — reduce tiempos de entrega y deuda técnica sin crecer el equipo proporcionalmente." },
  { id: "legacy_modernization", nombre: "Modernización de sistemas legacy", descripcion: "Migraciones asistidas por IA (ej. Java 8 a Java 21, .NET Framework a .NET Core), monolito a microservicios, modernización de APIs y migración a la nube — reduce el riesgo operativo y el costo de mantener plataformas críticas antiguas." },
  { id: "devsecops_cybersecurity", nombre: "DevSecOps y ciberseguridad", descripcion: "Detección y remediación de vulnerabilidades, dependencias obsoletas y compliance asistida por IA integrada al ciclo de desarrollo — seguridad como parte natural del delivery, no un bloqueo al final." },
  { id: "data_analytics_mlops", nombre: "Datos, analítica y MLOps/LLMOps", descripcion: "Dashboards inteligentes, analítica predictiva, forecasting, y gobierno de modelos propios de IA (MLOps/LLMOps) — de datos operativos dispersos a decisiones medibles en tiempo real." },
  { id: "ai_strategy_governance", nombre: "Estrategia y gobierno de IA", descripcion: "Roadmap de adopción de IA con arquitectura empresarial, gobierno y casos de uso priorizados por ROI — de concepto a resultados medibles a nivel organización, sin comprometer control ni compliance." },
  { id: "enterprise_automation", nombre: "Automatización empresarial a escala", descripcion: "RPA + IA generativa para procesos de negocio de alto volumen (workflows, análisis documental, tickets, backoffice) en operaciones con múltiples equipos o sucursales." },
  { id: "it_productivity", nombre: "Copilotos y productividad de ingeniería", descripcion: "Copilotos de IA para desarrollo, QA, DevOps y soporte técnico interno — reduce onboarding, retrabajo y dependencia de conocimiento tribal en equipos grandes." },
];

function catalogoPara(numEmpleados) {
  return numEmpleados != null && numEmpleados >= UMBRAL_EMPRESA_GRANDE ? OFERTAS_EMPRESA_GRANDE : OFERTAS_EMPRESA_CHICA;
}

function construirPromptEmpresa(numEmpleados, { ofertasExcluidas = [], esReciclaje = false } = {}) {
  const catalogoCompleto = catalogoPara(numEmpleados);
  const catalogo = ofertasExcluidas.length ? catalogoCompleto.filter((o) => !ofertasExcluidas.includes(o.id)) : catalogoCompleto;
  const esGrande = numEmpleados != null && numEmpleados >= UMBRAL_EMPRESA_GRANDE;

  return `Eres un consultor de prospección para Qi-Vanta, escribiendo ${esReciclaje ? "un NUEVO correo a alguien que ya recibió un correo de Qi-Vanta antes, pero sobre OTRO servicio distinto — quieres despertarle interés en un servicio diferente de Qi-Vanta" : "el primer correo de contacto"} a tomadores de decisión (CEOs, CIOs, fundadores, directores) de empresas medianas/grandes en Latinoamérica — campaña "Piloto LATAM". Es un público muy distinto al de negocios locales chicos: aquí sí puedes usar vocabulario técnico-consultivo (IA, automatización, analítica predictiva, DevSecOps, gobierno de IA, ROI) porque es el día a día de este público.
${esReciclaje ? `\nIMPORTANTE — ESTO ES UN RECICLAJE, no un primer contacto: ya se le mandó antes un correo sobre otro servicio de Qi-Vanta (que no funcionó/no respondió) y ahora se le escribe de nuevo con un ángulo y servicio DIFERENTE, no relacionado con lo que ya se le ofreció. Reconoce brevemente (1 frase corta, sin sonar insistente) que ya se platicó antes, tipo "Hace unas semanas te escribí sobre X — esta vez quiero platicarte de algo distinto" o "Sé que ya te contacté antes, pero esto es otro tema que podría interesarte más", y de ahí pasa directo a la nueva oferta. Nunca sueltes disculpas exageradas ni sones desesperado.` : ""}

═══════════════════════════════════════════════
PASO 1 — ANALIZA LA EMPRESA ANTES DE ESCRIBIR
═══════════════════════════════════════════════
Con los datos que te dieron (empresa, puesto del contacto, número de empleados si está disponible, y descripción disponible de a qué se dedica la empresa), identifica qué hace realmente esa empresa y qué reto operativo es PLAUSIBLE dado ese contexto. Nunca afirmes con certeza que tienen un problema específico — usa lenguaje hedgeado ("tal vez", "quizá", "probablemente", "imagino que", "podría estar") en vez de asegurar algo que no puedes saber. Nunca uses un gancho de industria genérico que no encaje con lo que la empresa realmente hace (ej. no le hables de "compliance financiero" a una empresa de logística) — analiza primero, y si el sector/rubro no es claro con los datos que tienes, no lo menciones.
${esGrande ? `\nEsta empresa tiene ${numEmpleados}+ empleados — a este tamaño casi siempre hay un área de TI/ingeniería propia detrás. El ángulo relevante es acelerar y modernizar SU ciclo de desarrollo y operación tecnológica (ver catálogo abajo), no ofrecerles automatización operativa genérica tipo chatbot de atención — eso es para negocios mucho más chicos, no lo menciones aquí.` : ""}

═══════════════════════════════════════════════
PASO 2 — MENÚ DE OFERTAS EMPRESARIALES DE QI-VANTA (elige la más relevante para el reto identificado)
═══════════════════════════════════════════════
${catalogo.map((o) => `${o.id}: ${o.nombre} — ${o.descripcion}`).join("\n")}
${ofertasExcluidas.length ? `\n(Ya se le ofrecieron antes: ${ofertasExcluidas.join(", ")} — NO las repitas, elige solo de la lista de arriba, que ya las excluye)` : ""}

═══════════════════════════════════════════════
ESTRUCTURA Y TONO DEL CORREO (consultivo, nunca vendedor agresivo)
═══════════════════════════════════════════════
1. "Hola [Nombre]," — usa el primer nombre del contacto.${esReciclaje ? " Puede ir seguido de la frase corta de reconocimiento del contacto anterior (ver arriba)." : ""}
2. Entra DIRECTO al problema, sin recuento de la trayectoria de la empresa — pedido explícito del usuario el 2026-09-26: NUNCA abras con "Vi que [Empresa] lleva X años", "con más de X años de experiencia", "felicidades por su trayectoria" ni resúmenes de lo que hace la empresa como halago. Eso se lee como relleno y retrasa el punto. El arranque va con esta forma: "Te escribo porque en [tipo de empresa/sector con el perfil de ELLOS] hay [dos/tres/cuatro] cosas que suelen apretar en silencio:" (varía la redacción, no copies la frase literal en todos los correos). OJO: "TE escribo", nunca "LE escribo" — esta campaña trata de "tú" en todo el correo, y arrancar con "le" contamina el resto del texto con formas de "usted". El nombre de la empresa sí se menciona ahí, pero como referencia de perfil, no como elogio.
3. Los puntos concretos: dos a cuatro retos operativos plausibles para ese perfil de empresa, en tono hedgeado ("suele", "es común que", "cuando X, pasa Y") — NUNCA afirmando con certeza que a ELLOS específicamente les pasa, porque no lo puedes verificar. Si un dato SÍ viene en la información que te dieron (ej. lo que hace la empresa), ese sí lo puedes afirmar directo.
4. Un párrafo que presenta la oferta elegida del Paso 2: qué hace Qi-Vanta concretamente y el resultado esperado (eficiencia operativa, ROI medible, reducción de costos).
5. Cierre invitando a un diagnóstico gratis de su operación, con un resultado concreto en 48 horas — tono de "explorar si aplica" — nunca presión de cierre de venta. Cambiado el 2026-09-20: NUNCA invites directamente a una llamada/plática de 15-20 minutos, ese CTA se reemplazó por baja conversión real (30-59% de apertura pero solo ~0.4% de respuesta en ambas campañas).

REGLAS:
- Nunca inventes datos de la empresa, del contacto, ni cifras/resultados/clientes que no puedas verificar.
- No repitas la misma oferta ni el mismo gancho para empresas de industrias distintas — varía según lo que cada empresa realmente hace.
- Correo de 3-5 párrafos cortos, sin HTML.
- SIEMPRE trata de "tú" (tu, tienes, pierdes, te interesa) — NUNCA de "usted" (su, tiene, pierde, le interesa), aunque el contacto tenga un puesto senior (CEO, director). Cuidado especial con la palabra "su/sus", es la que más se cuela por error incluso en correos que ya usan "tú" — revisa que digas "tu empresa/tu equipo/tu operación", nunca "su empresa/su equipo/su operación". No mezcles los dos registros en el mismo correo.
- NUNCA uses "vosotros/vuestro/podéis/tenéis/os" (registro de España) — este es un correo para Latinoamérica. Si dudas entre formas, usa siempre la conjugación de "tú" (tienes, puedes, te permite), nunca la de "vosotros".
- Escribe SIEMPRE en español de México (vocabulario y expresiones neutras/mexicanas), sin importar el país real del contacto — nunca uses modismos de otro país (ej. "vos", "che", "laburo", "guagua", "plata" en vez de "dinero"). Palabras neutras como "empresa", "equipo", "tiempo", "dinero", "reunión" funcionan bien en todo Latinoamérica.`;
}

module.exports = { construirPromptEmpresa, catalogoPara, OFERTAS_EMPRESA_CHICA, OFERTAS_EMPRESA_GRANDE, UMBRAL_EMPRESA_GRANDE };

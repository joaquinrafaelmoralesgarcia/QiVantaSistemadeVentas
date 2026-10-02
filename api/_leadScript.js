const { chatCompletionJSON } = require("./_deepinfraClient");
const { PROSPECTING_SYSTEM_PROMPT } = require("./_prospectingPrompt");
const { construirPromptEmpresa } = require("./_prospectingPromptEnterprise");
const { PROSPECTING_SYSTEM_PROMPT_GRANDE_GM } = require("./_prospectingPromptGrandeGoogleMaps");
const { elegirProductoParaLead } = require("./_productosLatam");
const { analizarSitio, lineaObservaciones } = require("./_analisisSitio");

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
// Datos reales verificados por el usuario (2026-09-15) — NUNCA agregar
// aquí un dato que no venga confirmado como real por el usuario. Se usan
// tal cual en la familia 7 de abajo, la IA nunca inventa su propio
// número/porcentaje.
const DATOS_REALES_VERIFICADOS = ["45% de los usuarios resuelven sus dudas con agentes de IA"];

// Cambiado de "dinero" a "tiempo", SOLO para Google Maps, el 2026-09-15
// — pedido explícito del usuario: "quita el tema de dinero en los
// titulos, pero si resalta lo del tiempo" (referido a Google Maps) +
// aclarado el mismo día: "esto de dinero solo en campaña de google, en
// la de piloto latam si mencionar dinero en titulos y tiempo como ya lo
// hacias" — Piloto LATAM sigue exigiendo dinero (como siempre), Google
// Maps ahora exige tiempo en vez de dinero. Las familias 6/7/8 (duplicar,
// dato real, curiosidad) son neutrales y se comparten entre las 2.
const FAMILIAS_COMPARTIDAS_6_7_8 = `6. DUPLICAR CLIENTES (usa esta AL AZAR de vez en cuando, sin importar si encaja perfecto con el análisis del Paso 1 — solo para variar): "¿Qué haces cuando tienes clientes pero no sabes cómo duplicarlos?" — excepción a la regla de arriba, puedes usarla o adaptarla tal cual.
7. DATO REAL VERIFICADO (usa esta AL AZAR de vez en cuando; excepción a la regla de arriba) — usa EXCLUSIVAMENTE uno de estos datos reales, tal cual o con mínima adaptación de redacción, JAMÁS inventes tu propio número o estadística: ${DATOS_REALES_VERIFICADOS.map((d) => `"${d}"`).join(" / ")}.
8. CURIOSIDAD DE RESOLUCIÓN — gancho de curiosidad sobre resolver todo desde el primer contacto, sin hacer esperar al cliente: "Descubre cómo mejorar la resolución en el primer contacto con tus clientes" / "¿Sabes cuánto tiempo se ahorra resolviendo todo desde el primer contacto?".`;

const REGLA_ASUNTO_GM = `DEBE mencionar tiempo/rapidez explícitamente (la palabra "tiempo", "rápido", "rápida", "minutos", "horas", "espera", "tarda", "tardas", "24/7" o similar) — nunca un asunto genérico sin ese enfoque. Elige la FAMILIA de tono que mejor encaje con el negocio/empresa según tu propio análisis del Paso 1 (no siempre la misma familia, varía entre leads distintos):

1. AHORRO DE TIEMPO DIRECTO — cuando el argumento más fuerte es reducir tiempo operativo (procesos manuales pesados, backoffice, tareas repetitivas): "Recupera las horas que hoy se van en tareas repetitivas" / "Lo que antes tardaba horas, ahora toma minutos" / "Menos tiempo perdido en tareas que una máquina ya puede hacer".
2. COMPARACIÓN CON COMPETENCIA — cuando el sector es competitivo/comoditizado y tardar en responder es un riesgo real: "Mientras tú tardas en contestar, tu competencia ya respondió" / "Cada minuto de espera es una oportunidad que se va con la competencia" / "Tu competencia ya no hace esperar a sus clientes".
3. CIERRE DE INTERÉS CONSULTIVO — buen default seguro cuando ninguna otra familia encaja con claridad: "Déjanos mostrarte en dónde se te está yendo el tiempo" / "Primero encontramos dónde se pierde tiempo, después vemos la solución" / "La propuesta empieza con tu tiempo, no con promesas".
4. DIRECTA/COMERCIAL — para negocios con urgencia visible o cuando conviene un golpe de impacto corto (calificación alta): "El tiempo que se va en tareas manuales ya se puede recuperar" / "Lo manual tarda más de lo que parece" / "Cada proceso manual tiene un costo de tiempo escondido".
5. VENTA CONSULTIVA — tono suave, funciona casi siempre, otro buen default: "Primero detectamos en dónde se va tu tiempo; después automatizamos" / "Donde hay repetición, hay tiempo que se puede recuperar".
${FAMILIAS_COMPARTIDAS_6_7_8}

IMPORTANTE — las frases de arriba (excepto la familia 7, que debe usarse tal cual por ser un dato real verificado) son solo EJEMPLOS de tono, NUNCA las copies textuales palabra por palabra: verificado el 2026-09-10 con una prueba real de 20 correos que, sin esta advertencia, el modelo repite la misma frase IDÉNTICA en 9 de 20 empresas distintas — eso se ve como spam masivo, no personalización. Escribe SIEMPRE tu propia versión, inspirada en el tono de la familia elegida pero con palabras distintas y, cuando sea posible, referenciando algo concreto de ESE negocio específico (su sector, su tamaño, el reto plausible del Paso 1).

No copies una frase literal igual entre leads distintos — adáptala o combínala con el gancho/observación real de ESE negocio cuando sea posible. No tiene que ser pregunta, puede ser una afirmación directa como los ejemplos de arriba, siempre que mencione tiempo/rapidez con una de las palabras de la lista (tiempo, rápido, rápida, minutos, horas, espera, tarda, tardas, 24/7). IMPORTANTE: jamás pongas un monto o porcentaje inventado ($5,000, 30%, etc.) ni un resultado de otro cliente que no te dieron — la única excepción de cifra permitida es la familia 7 (dato real verificado de la lista), nunca un número que tú mismo inventes.`;

// Piloto LATAM — SIGUE exigiendo dinero (como siempre), no tiempo. Pedido
// explícito del usuario el 2026-09-16: "esto de dinero solo en campaña
// de google, en la de piloto latam si mencionar dinero en titulos".
// Familias 1-5 en su versión original de dinero (sin cambios respecto a
// antes del 2026-09-15); familias 6/7/8 compartidas con Google Maps.
const REGLA_ASUNTO_LATAM = `DEBE mencionar dinero/costo explícitamente (la palabra "dinero", "cuesta", "gastas", "pagas", "ahorro", "margen" o similar) — nunca un asunto genérico sin ese enfoque. Elige la FAMILIA de tono que mejor encaje con el negocio/empresa según tu propio análisis del Paso 1 (no siempre la misma familia, varía entre leads distintos):

1. AHORRO DIRECTO — cuando el argumento más fuerte es reducir costo operativo (operación con procesos manuales pesados, backoffice, tareas repetitivas): "Te ayudamos a gastar menos haciendo lo mismo, pero más rápido" / "Donde hoy pagas horas hombre, nosotros ponemos automatización" / "Si un proceso te cuesta todos los meses, ahí hay oportunidad de ahorro" / "Menos operación manual, menos errores, menos gasto".
2. COMPARACIÓN CON COMPETENCIA — cuando el sector es competitivo/comoditizado y quedarse atrás es un riesgo real (retail, manufactura, servicios comerciales): "Tu competencia ya está automatizando; la pregunta es cuánto te está costando no hacerlo" / "Mientras otros reducen costos con IA, tú sigues pagando procesos manuales" / "Cada día que no automatizas, tu competencia gana margen".
3. CIERRE DE INTERÉS CONSULTIVO — buen default seguro cuando ninguna otra familia encaja con claridad: "Déjanos mostrarte dónde estás perdiendo dinero" / "Primero encontramos el ahorro, después vemos la solución" / "La propuesta empieza con números, no con promesas".
4. DIRECTA/COMERCIAL — para negocios con urgencia visible o cuando conviene un golpe de impacto corto (calificación alta): "El dinero se está yendo en tareas que una máquina ya puede hacer" / "Lo manual sale más caro de lo que parece" / "Cada Excel manual tiene un costo escondido".
5. VENTA CONSULTIVA — tono suave, funciona casi siempre, otro buen default: "Primero detectamos fugas de dinero; después automatizamos" / "Donde hay repetición, hay ahorro posible" / "La automatización no es gasto: es recuperación de dinero".
${FAMILIAS_COMPARTIDAS_6_7_8}

IMPORTANTE — las frases de arriba (excepto la familia 7, que debe usarse tal cual por ser un dato real verificado) son solo EJEMPLOS de tono, NUNCA las copies textuales palabra por palabra: verificado el 2026-09-10 con una prueba real de 20 correos que, sin esta advertencia, el modelo repite la misma frase IDÉNTICA en 9 de 20 empresas distintas — eso se ve como spam masivo, no personalización. Escribe SIEMPRE tu propia versión, inspirada en el tono de la familia elegida pero con palabras distintas y, cuando sea posible, referenciando algo concreto de ESE negocio específico (su sector, su tamaño, el reto plausible del Paso 1).

No copies una frase literal igual entre leads distintos — adáptala o combínala con el gancho/observación real de ESE negocio cuando sea posible. No tiene que ser pregunta, puede ser una afirmación directa como los ejemplos de arriba, siempre que mencione dinero/costo con una de las palabras de la lista (dinero, cuesta, gastas, pagas, ahorro, margen) — NO basta con "pierdes/perder" sola sin la palabra dinero. IMPORTANTE: jamás pongas un monto específico ($5,000, 30%, etc.) ni un resultado de otro cliente que no te dieron — la única excepción de cifra permitida es la familia 7 (dato real verificado de la lista), nunca un número que tú mismo inventes.`;

// Ajuste solo para Google Maps — pedido explícito del usuario el
// 2026-09-13, a partir de datos reales de apertura sincronizados ese día
// (442 leads con apertura confirmada): con muestra real y comparable
// (decenas de envíos por familia), "AHORRO DIRECTO" tuvo la tasa de
// apertura por envío más baja de las 6 familias (0.19, contra 0.86 de
// "DIRECTA/COMERCIAL", la mejor con muestra decente). En Piloto LATAM NO
// se aplica este ajuste — ahí la muestra de "directa_comercial" es
// todavía muy chica (4 envíos) para actuar con confianza, y el usuario
// explícitamente pidió dejar esa campaña igual por ahora.
const REGLA_ASUNTO_TIEMPO_GM = REGLA_ASUNTO_GM + `

AJUSTE POR DATOS REALES (Google Maps, 2026-09-13, medido cuando el enfoque todavía era dinero — el ajuste de familia sigue aplicando igual con el enfoque de tiempo): entre los negocios que ya hemos contactado, la familia 1 (AHORRO DE TIEMPO DIRECTO) es la que menos aperturas genera por correo enviado de las 6 — úsala poco, solo cuando ninguna otra encaje mejor. La familia 4 (DIRECTA/COMERCIAL) es la que mejor funciona — prefiérela quien tenga un gancho concreto y fuerte del negocio (reseñas altas, categoría con urgencia visible, sitio web ausente, etc.).`;

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
// asunto (mismo banco de frases de REGLA_ASUNTO_TIEMPO) y un ángulo
// genuinamente distinto al correo 1 y entre sí, mandados a los días 7 y
// 14 (el calendario de envío real vive en la secuencia de Smartlead, ver
// commit que actualiza seq_delay_details — aquí solo se genera el
// contenido).
// Función en vez de const fijo — pedido explícito del usuario el
// 2026-09-13: el rebalanceo de familias de asunto (REGLA_ASUNTO_TIEMPO_GM)
// solo aplica a Google Maps, así que los asuntos de seguimiento también
// necesitan poder recibir la regla de dinero correcta según campaña
// (antes REGLA_ASUNTO_TIEMPO quedaba fijo/compartido para las 2).
const construirReglaSeguimientos = (reglaDinero) => `"seguimiento1Asunto": "asunto del correo de seguimiento del día 7 — DEBE ser distinto al asuntoEmail del correo 1 (no lo repitas ni lo parafrasees). ${reglaDinero}",
  "seguimiento1": "correo de seguimiento completo (3-4 frases, puede ser un párrafo corto), se manda 7 días después si no responden. NO es una nota corta tipo 'sigo al pendiente' — es un correo con su propio valor: retoma la conversación desde un ÁNGULO DISTINTO al correo 1 (ej. si el correo 1 usó el gancho de X reto operativo, este puede enfocarse en otro reto plausible, o en la misma oferta pero desde el ángulo de riesgo de no actuar, o en una oferta secundaria del mismo catálogo). Nunca inventes cifras ni casos de éxito nuevos. Sin firma/despedida ni saludo repetido tipo 'Hola [Nombre]' otra vez si ya se saludó en el correo 1 — puede abrir directo con el gancho nuevo.",
  "seguimiento2Asunto": "asunto del correo de seguimiento del día 14 — DEBE ser distinto a asuntoEmail Y a seguimiento1Asunto. ${reglaDinero}",
  "seguimiento2": "correo de seguimiento final completo (3-4 frases), se manda 14 días después si no responden. Último intento antes de dejar de insistir — ángulo distinto a los 2 correos anteriores (ej. cierre de baja presión tipo 'este es mi último mensaje por ahora' pero seguido de una razón concreta y nueva para platicar, no solo la despedida sola). Nunca inventes cifras ni casos de éxito nuevos. Sin firma/despedida."`;

const REGLA_SEGUIMIENTOS = construirReglaSeguimientos(REGLA_ASUNTO_LATAM);
const REGLA_SEGUIMIENTOS_GM = construirReglaSeguimientos(REGLA_ASUNTO_TIEMPO_GM);

// Banco de "ofertas gratis" (lead magnets) — pedido explícito del usuario
// el 2026-09-12 (Piloto LATAM) y ampliado el mismo día a Google Maps
// también ("esto ultimo que agregamos tambien que sea para la campaña de
// google maps"): agregar al final del cuerpo, según el análisis ya hecho
// (misma oferta/oportunidad elegida en el Paso 2), uno de estos 23 temas.
// Compartido entre las 2 campañas — el modelo elige el que mejor encaje
// con SU catálogo (7 ofertas empresariales en LATAM/GM-grande, 15
// oportunidades PYME en GM normal), igual que ya pasa con el banco de
// frases de asunto.
const OFERTAS_GRATIS = [
  "🎁 Assessment de IA y Automatización sin costo",
  "🔍 Diagnóstico gratuito de uno de tus procesos actuales",
  "💰 Identificación de oportunidades concretas de ahorro",
  "📊 Estimación inicial de ROI de las oportunidades detectadas",
  "⚙️ Identificación de procesos que pueden automatizarse con IA",
  "⏱️ Estimación de horas operativas que podrías recuperar mensualmente",
  "📉 Detección de tareas manuales y repetitivas que pueden reducirse",
  "🚀 3 casos de uso de IA personalizados para tu empresa",
  "🗺️ Roadmap inicial de automatización sin costo",
  "🧪 Evaluación de viabilidad para implementar un piloto",
  "💻 Demo personalizada de una solución aplicable a tu operación",
  "📋 Reporte ejecutivo con oportunidades detectadas",
  "🏗️ Assessment de modernización tecnológica para sistemas legacy",
  "🤖 Assessment de productividad de desarrollo y AI-SDLC",
  "🛡️ Revisión inicial de oportunidades de DevSecOps y automatización de seguridad",
  "📈 Assessment para automatizar ventas, seguimiento de prospectos y cotizaciones",
  "💳 Assessment de automatización de cobranza y procesos financieros",
  "📄 Assessment para automatización de facturas, PDFs, correos y documentos",
  "💬 Evaluación para automatizar atención mediante WhatsApp, chatbots o asistentes de voz",
  "🧠 Evaluación de un copiloto privado conectado a la información de tu empresa",
  "🧪 Acceso a un piloto de bajo riesgo antes de realizar una implementación mayor",
  "🎓 Workshop ejecutivo introductorio de IA y automatización",
  "🎁 Primer mes de soporte sin costo en proyectos seleccionados",
  "💵 Precio preferencial en el primer piloto de automatización",
];

// DeepInfra (Qwen3.5-9B) no soporta el modo estricto output_config/json_schema
// de Anthropic — en vez de eso, el formato exacto se exige por instrucción de
// texto (verificado el 2026-09-03: sin "no agregues clave adicional" el
// modelo a veces mete una clave "firma" suelta además de cuerpoEmail).
const JSON_INSTRUCTIONS = `

Responde ÚNICAMENTE con un objeto JSON válido (sin markdown, sin \`\`\`, sin texto fuera del JSON), con exactamente estas 10 claves:
{
  "calificacion": "alta" | "media" | "baja" (qué tan buen prospecto es: alta si claramente necesita automatización/IA y parece tener presupuesto, baja si no aplica bien),
  "razonamiento": "1 frase interna explicando la calificación, no se envía al lead, es para el vendedor",
  "mensajeWhatsapp": "mensaje corto, máx 280 caracteres, tono cercano y directo en español de México, cierra con pregunta abierta. Nunca escribas placeholders entre corchetes como [Nombre] — no sabes el nombre de quien lee, dirígete directo al negocio o usa un saludo genérico ('Hola,'). NO incluyas firma ni datos de contacto, se agregan automáticamente después",
  "asuntoEmail": "asunto corto, máx 60 caracteres. ${REGLA_ASUNTO_TIEMPO_GM}",
  "cuerpoEmail": "correo frío completo, 3-5 frases cortas, sin HTML. Igual que el asunto, el cuerpo también debe reforzar el enfoque de dinero perdido/dejado de ganar por el problema detectado — no basta con mencionarlo solo en el asunto, dedica al menos 1 frase del cuerpo a plantear el costo en dinero de NO resolver ese problema (ej. 'cada cliente que se va sin cotización es dinero que ya gastaste en atraerlo'), antes de presentar la oferta como la solución a esa pérdida. NUNCA inventes una cifra específica ($5,000, 30%, 'ahorra X pesos') ni afirmes resultados con otros clientes ('hemos ayudado a empresas a lograr...') que no puedas verificar — el enfoque de dinero se queda en pregunta retórica o concepto, jamás en un número o caso de éxito inventado. No te presentes por nombre en ningún punto del texto (ni al inicio ni al final) — nunca escribas 'me llamo...' ni placeholders entre corchetes como [Nombre]. No incluyas firma, despedida ('Saludos', 'Equipo Qi-Vanta') ni datos de contacto — todo eso se agrega automáticamente después, fuera de este texto. ARRANQUE (pedido explícito del usuario el 2026-09-26): entra DIRECTO al problema, nunca con recuento ni halago de la trayectoria del negocio — prohibido abrir con 'Vi que llevan X años', 'con su excelente reputación', 'felicidades por sus reseñas' o resúmenes de lo que hace el negocio como elogio. La forma correcta es nombrar de entrada lo que suele apretar en negocios de ESE giro (ej. 'En consultorios dentales como el tuyo suele pasar que...'), y de ahí al costo en dinero. Varía la redacción entre correos, no copies una frase fija. Sigue con el costo en dinero de no resolverlo, presenta la oferta, y termina invitando a un diagnóstico gratis con resultado concreto en 48 horas (NO invites a una llamada/plática de 15-20 minutos — ese CTA se reemplazó el 2026-09-20 por baja tasa de respuesta real: 30-59% de apertura pero solo ~0.4% de respuesta en ambas campañas, señal de que pedir una llamada de entrada no convierte)",
  "ofertaGratis": "elige EXACTAMENTE uno de estos 23 textos (cópialo tal cual, con emoji incluido), el que mejor encaje con la oportunidad que ya elegiste en el Paso 2:\n${OFERTAS_GRATIS.map((o) => `  - ${o}`).join("\n")}",
  ${REGLA_SEGUIMIENTOS_GM}
}
No agregues ninguna clave adicional fuera de esas 10.`;

// Variante para Google Maps cuando _empresaGrande.js marca el negocio como
// probable cadena/empresa grande — igual que JSON_INSTRUCTIONS pero
// agrega "oferta" (id del catálogo enterprise elegido, para auditar cuál
// se usó) — pedido explícito del usuario el 2026-09-10.
const JSON_INSTRUCTIONS_GRANDE_GM = `

Responde ÚNICAMENTE con un objeto JSON válido (sin markdown, sin \`\`\`, sin texto fuera del JSON), con exactamente estas 11 claves:
{
  "calificacion": "alta" | "media" | "baja" (qué tan buen prospecto es: alta si claramente necesita automatización/IA y parece tener presupuesto, baja si no aplica bien),
  "razonamiento": "1 frase interna explicando la calificación, no se envía al lead, es para el vendedor",
  "oferta": "el id exacto de la oferta elegida del menú (ej. 'ai_native_sdlc', 'legacy_modernization')",
  "mensajeWhatsapp": "mensaje corto, máx 280 caracteres, tono cercano y directo en español de México, cierra con pregunta abierta. Nunca escribas placeholders entre corchetes como [Nombre] — no sabes el nombre de quien lee, dirígete directo al negocio o usa un saludo genérico ('Hola,'). NO incluyas firma ni datos de contacto, se agregan automáticamente después",
  "asuntoEmail": "asunto corto, máx 60 caracteres. ${REGLA_ASUNTO_TIEMPO_GM}",
  "cuerpoEmail": "correo frío completo, 3-5 párrafos cortos, sin HTML. Igual que el asunto, el cuerpo también debe reforzar el enfoque de dinero perdido/dejado de ganar por el problema detectado. NUNCA inventes una cifra específica ni afirmes resultados con otros clientes que no puedas verificar. No te presentes por nombre en ningún punto del texto. No incluyas firma, despedida ni datos de contacto — se agrega automáticamente después. ARRANQUE (pedido explícito del usuario el 2026-09-26): entra DIRECTO al problema, nunca con recuento ni halago de la trayectoria de la empresa — prohibido abrir con 'Vi que llevan X años', 'con su excelente reputación' o resúmenes de lo que hace la empresa como elogio. La forma correcta es nombrar de entrada lo que suele apretar en operaciones de ESE perfil (ej. 'En operaciones con varias sucursales como la de [Empresa] suele pasar que...'). Varía la redacción entre correos, no copies una frase fija. Sigue con el costo en dinero de no resolverlo, presenta la oferta, y termina invitando a un diagnóstico gratis con resultado concreto en 48 horas (NO invites a una llamada/plática de 15-20 minutos — ese CTA se reemplazó el 2026-09-20 por baja tasa de respuesta real: 30-59% de apertura pero solo ~0.4% de respuesta en ambas campañas, señal de que pedir una llamada de entrada no convierte)",
  "ofertaGratis": "elige EXACTAMENTE uno de estos 23 textos (cópialo tal cual, con emoji incluido), el que mejor encaje con la 'oferta' que ya elegiste arriba:\n${OFERTAS_GRATIS.map((o) => `  - ${o}`).join("\n")}",
  ${REGLA_SEGUIMIENTOS_GM}
}
No agregues ninguna clave adicional fuera de esas 11.`;

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
joaquin.morales@qi-vanta.com
+52 720 644 2283

Aviso de privacidad: https://www.qi-vanta.com/aviso-privacidad.html`;

// Frase fija que debe ir en TODOS los correos de la campaña de Apify/Google
// Maps, sin importar qué oferta haya elegido el modelo — pedido explícito
// del usuario el 2026-09-04. Se agrega en código (no se le pide al modelo
// que la redacte) para que el texto salga siempre idéntico.
// Reescrita el 2026-09-15 — encontrado en real que esta línea fija
// reintroducía la palabra "Chatbots" justo después del cuerpo, aun
// cuando el cuerpo ya evitaba liderar con eso (pedido explícito del
// usuario tras ver una respuesta real de un prospecto rechazando por
// "ya tenemos chatbot"). Ahora lidera con el resultado (llamadas
// contestadas, citas agendadas) en vez del medio.
const LINEA_VOZ_IA = "También contestamos tus llamadas con voz natural de IA y agendamos citas automáticamente, las 24 horas.";

// Complemento fijo adicional para Google Maps — pedido explícito del
// usuario el 2026-09-10: "ofrece APPs aplicaciones moviles y Sitios Web,
// adicional a los demas servicios... es un complemento del contenido de
// mensaje que ya mandas". Igual que LINEA_VOZ_IA, se agrega en código, no
// se le pide al modelo — y solo en el catálogo PYME (no en el catálogo
// "empresa grande" de Google Maps, que ya tiene su propio enfoque
// enterprise, igual que LINEA_VOZ_IA tampoco aplica ahí).
const LINEA_APPS_WEB_PYME = "También desarrollamos apps móviles y sitios web a la medida para tu negocio.";

// Mismo complemento para Piloto LATAM, solo apps (el usuario no pidió
// sitios web ahí) — pedido explícito del usuario el 2026-09-10: "ofrece
// APPs tambien en la campaña de piloto latam". Aplica a los 2 catálogos
// (chico y grande), a diferencia de LINEA_VOZ_IA que no existe en LATAM.
const LINEA_APPS_LATAM = "También desarrollamos aplicaciones móviles a la medida para tu operación.";

// Línea fija final para TODO correo de AMBAS campañas (correo 1,
// seguimiento1 y seguimiento2) — pedido explícito del usuario el
// 2026-09-11: "a todo tipo de correo enviado... al final agregues 'te
// creamos un Demo prototipo sin costo'... que se vea esto al final
// sobresaliente". Va en negrita (HTML) para que resalte — Smartlead
// renderiza HTML real dentro del merge tag (confirmado: la firma de
// cuenta ya usa <div>/<img>/<a href> reales), así que <strong> debe
// mostrarse en negrita en el correo entregado, no como texto plano con
// los símbolos < > visibles.
// Cambiado el 2026-09-20 de "Te creamos un demo/prototipo sin costo" a un
// diagnóstico con resultado en 48h — pedido explícito del usuario
// tras ver que ninguna de las 2 campañas convertía aperturas en
// respuestas (30-59% de apertura pero solo ~0.4% de respuesta): la
// hipótesis es que pedir una llamada de 15-20 min de entrada pide
// demasiado compromiso antes de mostrar valor concreto; un resultado
// tangible en 48h sin llamada es un compromiso menor para el lead.
// Garantia de devolucion — pedido explicito del usuario el 2026-10-02: al
// final del cuerpo de Piloto LATAM y Google Maps, "si no disminuimos costo
// y tiempo en su operacion le regresamos su dinero". Es un COMPROMISO
// COMERCIAL, por eso es texto fijo en codigo y nunca lo redacta el modelo.
// Adaptado a "tu" (las campanas automaticas nunca usan "su/le").
const LINEA_GARANTIA = "<strong>Si no reducimos costo y tiempo en tu operación, te regresamos tu dinero.</strong>";
const LINEA_DEMO_GRATIS = "<strong>Te hacemos un diagnóstico gratis de tu negocio, con un resultado concreto en 48 horas.</strong>";

// Link de landing por campaña — pedido explícito del usuario el
// 2026-09-13: va a construir una landing DISTINTA para Google Maps (PYME),
// separada de qi-vanta.com (que queda para Piloto LATAM/enterprise). Antes
// este link vivía fijo en la firma de cuenta de Smartlead, pero esas 6
// cuentas mandan para LAS 2 campañas — cambiarlo ahí habría afectado a
// ambas a la vez. Se quitó de la firma (ver commit del mismo día) y se
// movió aquí, en código, exactamente igual que ya se hace con toda otra
// diferencia de contenido entre campañas. Mientras la landing de Google
// Maps no exista, apunta a qi-vanta.com también (sin romper nada) — es
// cambiar esta única constante cuando esté lista.
const URL_LANDING_LATAM = "https://www.qi-vanta.com";
const URL_LANDING_GM = "https://negocios.qi-vanta.com"; // landing PYME lista el 2026-09-13
const LINEA_LANDING_LATAM = `Conoce más en <a href="${URL_LANDING_LATAM}">${URL_LANDING_LATAM.replace("https://", "")}</a>`;
const LINEA_LANDING_GM = `Conoce más en <a href="${URL_LANDING_GM}">${URL_LANDING_GM.replace("https://", "")}</a>`;

// Google Maps no tenía el link al catálogo enterprise (negocios.qi-vanta.com/
// enterprise/) en el cuerpo — solo Piloto LATAM y Alianzas lo tenían, vía
// lineaProductoLatam()/el cuerpo fijo de _alianzasScript.js. Agregado el
// 2026-09-21 — pedido explícito del usuario tras notar la firma
// duplicaba el link que Piloto LATAM/Alianzas ya traían en el cuerpo:
// en vez de quitarlo de la firma (afectaría a las 3 campañas por igual,
// la firma es por CUENTA, no por campaña), se decidió que las 3
// campañas lo traigan en el cuerpo también, por consistencia.
const URL_ENTERPRISE = "https://negocios.qi-vanta.com/enterprise/";
const LINEA_SERVICIOS_ENTERPRISE = `También puedes ver el resto de nuestras soluciones de IA aquí: <a href="${URL_ENTERPRISE}">${URL_ENTERPRISE}</a>`;

// Catálogo de videos para Google Maps — pedido explícito del usuario el
// 2026-09-16: "tendremos un portafolio de videos que despues tu
// seleccionaras el link de este catalogo para saber cual enviar en cada
// correo". Por ahora solo hay 1 video (agenda/citas automáticas, el uso
// más demandado según el análisis de mercado del mismo día — WhatsApp +
// llamadas para agendar citas). Cuando haya más videos, se agregan aquí
// y se puede elegir por tema/categoría en vez de usar siempre el mismo.
const VIDEOS_GM = [
  { id: "agenda_citas_salud", url: "https://negocios.qi-vanta.com/videos/qi-vanta-cita.mp4", tema: "agenda y citas automáticas por WhatsApp y llamadas" },
];
function lineaVideoGM() {
  const video = VIDEOS_GM[0]; // único disponible por ahora
  return `Míralo funcionando en 30 segundos: <a href="${video.url}">${video.url}</a>`;
}

// Catálogo de videos para Piloto LATAM — pedido explícito del usuario el
// 2026-09-17. Primer video basado en el dato real de métricas: la
// familia "duplicar_clientes" es la de mejor desempeño real en esta
// campaña (134 aperturas en 122 envíos, la mejor muestra sólida) — el
// video muestra justo ese ángulo (crecer sin duplicar la carga
// operativa). Alojado en negocios.qi-vanta.com por ser el único dominio
// con despliegue activo desde aquí (qi-vanta.com vive en Cloudflare).
const VIDEOS_LATAM = [
  { id: "duplicar_clientes_enterprise", url: "https://negocios.qi-vanta.com/videos/qi-vanta-escala.mp4", tema: "crecer/escalar sin duplicar la carga operativa" },
];
function lineaVideoLatam() {
  const video = VIDEOS_LATAM[0]; // único disponible por ahora
  return `Míralo funcionando en 30 segundos: <a href="${video.url}">${video.url}</a>`;
}

// Catálogo enterprise (~90 líneas de solución de IA por área/industria) —
// pedido explícito del usuario el 2026-09-18: "genera un link de vercel
// para que puedan ver nuestros productos... ofrece uno de estos de
// acuerdo a la empresa o negocio de los leads". elegirProductoParaLead()
// mapea empresa/descripción/puesto del lead a la línea que mejor encaja
// (ver _productosLatam.js); el link con ?p=slug resalta esa misma línea
// en la página al abrirla, sin que el resto del catálogo desaparezca.
function lineaProductoLatam(lead) {
  const producto = elegirProductoParaLead(lead);
  const url = `https://negocios.qi-vanta.com/enterprise/?p=${producto.slug}`;
  return `Para empresas como la tuya, una de las líneas que más se pide es "${producto.nombre}": ${producto.resumen} Puedes ver ese ejemplo y el resto de líneas que trabajamos aquí: <a href="${url}">${url}</a>`;
}

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

Responde ÚNICAMENTE con un objeto JSON válido (sin markdown, sin \`\`\`, sin texto fuera del JSON), con exactamente estas 10 claves:
{
  "calificacion": "alta" | "media" | "baja" (qué tan buen prospecto es: alta si claramente necesita automatización/IA y parece tener presupuesto/tamaño para invertir, baja si no aplica bien),
  "razonamiento": "1 frase interna explicando la calificación, no se envía al lead, es para el vendedor",
  "oferta": "el id exacto de la oferta elegida del menú (ej. 'data_analytics', 'enterprise_automation')",
  "ofertaGratis": "elige EXACTAMENTE uno de estos 23 textos (cópialo tal cual, con emoji incluido), el que mejor encaje con la 'oferta' que ya elegiste arriba (ej. si elegiste 'legacy_modernization', usa el de modernización de sistemas legacy; si elegiste 'devsecops_cybersecurity', usa el de DevSecOps):\n${OFERTAS_GRATIS.map((o) => `  - ${o}`).join("\n")}",
  "asuntoEmail": "asunto corto, máx 60 caracteres. ${REGLA_ASUNTO_LATAM}",
  "cuerpoEmail": "correo completo siguiendo la estructura de 5 pasos del prompt (saludo con nombre, gancho real sobre la empresa, reto plausible en tono hedgeado, oferta elegida, cierre invitando a un diagnóstico gratis con resultado concreto en 48 horas — NUNCA invites a una llamada/plática de 15-20 minutos, ese CTA se reemplazó el 2026-09-20 por baja conversión real), sin HTML. NUNCA inventes una cifra específica ($, %, ahorro en dinero) ni afirmes resultados con otros clientes ('hemos ayudado a bancos a lograr X%', 'nuestros clientes ahorran Y') que no puedas verificar — eso es mentir con datos y casos de éxito falsos a un tomador de decisión real. El enfoque de dinero/OPEX se queda en pregunta retórica o concepto, nunca en un número o cliente inventado. No te presentes por nombre en ningún punto del texto — nunca escribas 'me llamo...' ni placeholders entre corchetes. No incluyas firma ni despedida — se agrega automáticamente después, fuera de este texto. NO incluyas tú mismo el texto de 'ofertaGratis' dentro del cuerpo, se agrega aparte, en código, al final",
  ${REGLA_SEGUIMIENTOS}
}
No agregues ninguna clave adicional fuera de esas 10.`;

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
// Palabras clave por campaña — pedido explícito del usuario el
// 2026-09-16: el tema de tiempo (en vez de dinero) es SOLO para Google
// Maps; Piloto LATAM sigue exigiendo dinero, como siempre.
const PALABRAS_TIEMPO = /(tiempo|r[aá]pid[oa]|minutos?|horas?|espera|tardas?|tarda|24\/7)/i;
const PALABRAS_DINERO = /(dinero|cuesta|cuestan|gastas|gastan|pagas|pagan|pagar|ahorro|ahorras|margen|costo|costos)/i;
const PALABRAS_USTED = /\b(su|sus|suyo|suya|usted|ustedes)\b/i;
// Excepciones — pedido explícito del usuario: familia #6 "DUPLICAR
// CLIENTES" (2026-09-11) y familia #7 "DATO REAL VERIFICADO" (2026-09-15,
// detectada por traer un número+% de la lista DATOS_REALES_VERIFICADOS)
// no necesitan palabra de tiempo/dinero, en ninguna campaña.
const EXCEPCION_DUPLICAR = /duplicar/i;
const EXCEPCION_DATO_REAL = /\d+\s*%/;

async function corregirAsunto(asuntoOriginal, contexto, { esEmpresa = false } = {}) {
  const PALABRAS_TEMA = esEmpresa ? PALABRAS_DINERO : PALABRAS_TIEMPO;
  const nombreTema = esEmpresa ? "dinero/costo" : "tiempo/rapidez";
  const ejemplos = esEmpresa ? "'dinero', 'cuesta', 'gastas', 'ahorro', 'costo'" : "'tiempo', 'rápido', 'minutos', 'horas', 'espera', 'tarda'";

  const problemas = [];
  if (!PALABRAS_TEMA.test(asuntoOriginal) && !EXCEPCION_DUPLICAR.test(asuntoOriginal) && !EXCEPCION_DATO_REAL.test(asuntoOriginal)) problemas.push(`no menciona ${nombreTema} explícitamente (agrega una palabra como ${ejemplos})`);
  if (PALABRAS_USTED.test(asuntoOriginal)) problemas.push("usa 'su/usted' — debe ser 'tú/tu'");
  if (!problemas.length) return asuntoOriginal;

  try {
    const fix = await chatCompletionJSON({
      system: `Reescribes UNA línea de asunto de correo en español de México, corrigiendo SOLO estos problemas: ${problemas.join("; ")}. Mantén la misma idea/gancho del asunto original, cámbialo lo mínimo posible. Responde ÚNICAMENTE con JSON: {"asunto": "..."}`,
      user: `Asunto original: "${asuntoOriginal}"\nContexto: ${contexto}`,
      maxTokens: 60,
    });
    return fix?.asunto && PALABRAS_TEMA.test(fix.asunto) && !PALABRAS_USTED.test(fix.asunto) ? fix.asunto.trim() : asuntoOriginal;
  } catch (err) {
    console.error("Error corrigiendo asunto:", err.message);
    return asuntoOriginal;
  }
}

async function corregirAsuntosDelScript(script, contexto, { esEmpresa = false } = {}) {
  if (!script) return script;
  if (script.asuntoEmail) script.asuntoEmail = await corregirAsunto(script.asuntoEmail, contexto, { esEmpresa });
  if (script.seguimiento1Asunto) script.seguimiento1Asunto = await corregirAsunto(script.seguimiento1Asunto, contexto, { esEmpresa });
  if (script.seguimiento2Asunto) script.seguimiento2Asunto = await corregirAsunto(script.seguimiento2Asunto, contexto, { esEmpresa });
  return script;
}

// Validación real para cifras inventadas — encontrada probando en vivo el
// 2026-09-10: pese a la regla explícita de "NUNCA inventes una cifra
// específica" (presente desde el 2026-09-04), el modelo metió "reduciendo
// hasta un 40% el tiempo de entrega" en un correo real de prueba,
// repetido igual en 2 corridas distintas — un patrón, no un accidente
// aislado. Solo detecta % y $ seguidos de dígito (no "15-20 minutos" ni
// "día 14", que son horarios/fechas legítimos, no cifras de resultado).
const CIFRA_INVENTADA = /\d+\s*%|\$\s?\d/;

// Misma familia de problema, sin números — encontrado probando en vivo el
// 2026-09-13 con el ejemplo de Piloto LATAM para Logivance: "Te mostraré
// cómo hemos ayudado a otros operadores logísticos a optimizar sus
// procesos" — un caso de éxito con clientes reales inventado, exactamente
// lo que la regla ya prohíbe explícitamente ("hemos ayudado a bancos a
// lograr X%", "nuestros clientes ahorran Y"), pero sin cifra que
// CIFRA_INVENTADA pudiera detectar. Cubre las frases típicas de este
// patrón sin atrapar afirmaciones legítimas de CAPACIDAD genérica (ej.
// "ayudamos a empresas como la tuya a migrar estos sistemas" no dispara,
// porque no referencia "otros/otras" clientes ni un resultado ya logrado).
const CLIENTE_INVENTADO = /hemos ayudado a (otr|banc|client|empres)|nuestros clientes (han |ya )?(logra|consegu|ahorra|reduje|mejora)|ya (hemos )?ayudado a/i;

async function corregirCifraInventada(texto, contexto) {
  if (!texto || (!CIFRA_INVENTADA.test(texto) && !CLIENTE_INVENTADO.test(texto))) return texto;
  try {
    const fix = await chatCompletionJSON({
      system: `Reescribes un correo en español de México, eliminando SOLO: (1) cifras/porcentajes/montos específicos inventados (ej. "40%", "$5,000") y (2) menciones de resultados o casos de éxito con OTROS clientes que no se pueden verificar (ej. "hemos ayudado a otros bancos a lograr...", "nuestros clientes ahorran..."). Cámbialos por lenguaje de capacidad genérica sin número ni referencia a otros clientes (ej. "reduce significativamente" en vez de "reduce un 40%"; "podemos ayudarte a optimizar tus procesos" en vez de "hemos ayudado a otros operadores a optimizar sus procesos"). No cambies nada más del texto. Responde ÚNICAMENTE con JSON: {"texto": "..."}`,
      user: `Texto original:\n\n${texto}\n\nContexto: ${contexto}`,
      maxTokens: 900,
    });
    return fix?.texto && !CIFRA_INVENTADA.test(fix.texto) && !CLIENTE_INVENTADO.test(fix.texto) ? fix.texto.trim() : texto.replace(CIFRA_INVENTADA, "").replace(CLIENTE_INVENTADO, "").trim();
  } catch (err) {
    console.error("Error corrigiendo cifra inventada:", err.message);
    return texto;
  }
}

async function corregirCifrasDelScript(script, contexto) {
  if (!script) return script;
  if (script.cuerpoEmail) script.cuerpoEmail = await corregirCifraInventada(script.cuerpoEmail, contexto);
  if (script.seguimiento1) script.seguimiento1 = await corregirCifraInventada(script.seguimiento1, contexto);
  if (script.seguimiento2) script.seguimiento2 = await corregirCifraInventada(script.seguimiento2, contexto);
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

  // El análisis del sitio corre EN PARALELO con la generación del correo,
  // no en serie — así no suma tiempo al presupuesto de 60s de Vercel, que
  // ya está ajustado (MAX_NUEVOS_POR_CORRIDA=2 por timeouts reales).
  // Nunca tumba la generación: si falla, devuelve null y no se anexa nada.
  const [script, analisisSitio] = await Promise.all([
    chatCompletionJSON({
      system: construirPromptEmpresa(lead.numEmpleados, { ofertasExcluidas: lead.ofertasExcluidas || [], esReciclaje: Boolean(lead.esReciclaje) }) + JSON_INSTRUCTIONS_EMPRESA + OPEX_SUFFIX,
      user: `Con estos datos públicos de una empresa y su contacto, genera el correo de ${lead.esReciclaje ? "reciclaje (otro servicio distinto, ver instrucciones)" : "primer contacto"} (nunca inventes datos que no te dieron):\n\n${detalles}`,
      maxTokens: 1900,
    }),
    analizarSitio(lead.sitioWeb).catch(() => null),
  ]);
  const observaciones = lineaObservaciones(analisisSitio);
  await corregirAsuntosDelScript(script, `Empresa: ${lead.empresa}, contacto: ${lead.nombre}`, { esEmpresa: true });
  await corregirCifrasDelScript(script, `Empresa: ${lead.empresa}, contacto: ${lead.nombre}`);

  // LINEA_VOZ_IA ("Adicionamos Chatbots...") es exclusiva de Google Maps/
  // Apify (ver su comentario arriba) — NO va aquí. Se agregaba por error en
  // todo correo de Piloto LATAM hasta el 2026-09-10, incluyendo a empresas
  // de miles de empleados, contradiciendo la oferta consultiva ya elegida.
  // LINEA_APPS_LATAM sí va aquí (pedido explícito del usuario el
  // 2026-09-10), en los 2 catálogos (chico y grande).
  // ofertaGratis: si el modelo no copió el texto exacto del banco, se
  // ignora en vez de mandar un texto inventado/parafraseado al lead.
  const ofertaGratisValida = OFERTAS_GRATIS.includes(script.ofertaGratis) ? script.ofertaGratis : null;
  if (script.cuerpoEmail) {
    // Observaciones reales del sitio de la empresa (ver _analisisSitio.js)
    // — agregado el 2026-09-26. Va ANTES del bloque de ofertas fijas para
    // que se lea como parte del análisis del negocio, no como anexo
    // publicitario. Si no hay sitio o el análisis falla, queda vacío y el
    // correo sale exactamente como antes.
    const bloqueObservaciones = observaciones ? `\n\n${observaciones}` : "";
    script.cuerpoEmail = script.cuerpoEmail.trim() + bloqueObservaciones + `\n\n${LINEA_APPS_LATAM}` + (ofertaGratisValida ? `\n\n${ofertaGratisValida}` : "") + `\n\n${lineaVideoLatam()}\n\n${lineaProductoLatam(lead)}\n\n${LINEA_DEMO_GRATIS}\n\n${LINEA_LANDING_LATAM}

${LINEA_GARANTIA}`;
  }
  if (script.seguimiento1Asunto) script.seguimiento1Asunto = script.seguimiento1Asunto.trim();
  if (script.seguimiento1) script.seguimiento1 = script.seguimiento1.trim() + `\n\n${LINEA_DEMO_GRATIS}\n\n${LINEA_LANDING_LATAM}`;
  if (script.seguimiento2Asunto) script.seguimiento2Asunto = script.seguimiento2Asunto.trim();
  if (script.seguimiento2) script.seguimiento2 = script.seguimiento2.trim() + `\n\n${LINEA_DEMO_GRATIS}\n\n${LINEA_LANDING_LATAM}`;
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
  await corregirCifrasDelScript(script, `Negocio: ${negocio.nombre}, categoría: ${negocio.categoria || "desconocida"}`);

  // ofertaGratis: si el modelo no copió el texto exacto del banco, se
  // ignora en vez de mandar un texto inventado/parafraseado al lead —
  // pedido explícito del usuario el 2026-09-12, extendido a Google Maps.
  const ofertaGratisValida = OFERTAS_GRATIS.includes(script.ofertaGratis) ? script.ofertaGratis : null;
  const sufijoOfertaGratis = ofertaGratisValida ? `\n\n${ofertaGratisValida}` : "";

  if (script.mensajeWhatsapp) script.mensajeWhatsapp += FIRMA_WHATSAPP;
  if (script.cuerpoEmail) {
    script.cuerpoEmail = esGrande
      ? script.cuerpoEmail.trim() + sufijoOfertaGratis + `\n\n${lineaVideoGM()}\n\n${LINEA_DEMO_GRATIS}\n\n${LINEA_SERVICIOS_ENTERPRISE}\n\n${LINEA_LANDING_GM}

${LINEA_GARANTIA}`
      : script.cuerpoEmail.trim() + `\n\n${LINEA_VOZ_IA}\n\n${LINEA_APPS_WEB_PYME}` + sufijoOfertaGratis + `\n\n${lineaVideoGM()}\n\n${LINEA_DEMO_GRATIS}\n\n${LINEA_SERVICIOS_ENTERPRISE}\n\n${LINEA_LANDING_GM}

${LINEA_GARANTIA}`;
  }
  if (script.seguimiento1Asunto) script.seguimiento1Asunto = script.seguimiento1Asunto.trim();
  if (script.seguimiento1) script.seguimiento1 = script.seguimiento1.trim() + `\n\n${LINEA_DEMO_GRATIS}\n\n${LINEA_SERVICIOS_ENTERPRISE}\n\n${LINEA_LANDING_GM}`;
  if (script.seguimiento2Asunto) script.seguimiento2Asunto = script.seguimiento2Asunto.trim();
  if (script.seguimiento2) script.seguimiento2 = script.seguimiento2.trim() + `\n\n${LINEA_DEMO_GRATIS}\n\n${LINEA_SERVICIOS_ENTERPRISE}\n\n${LINEA_LANDING_GM}`;
  return script;
}

// Para leads que YA se mandaron a Smartlead antes de que existiera el
// seguimiento (2026-09-05) — genera solo los 2 seguimientos a partir del
// correo que ya se envió, en vez de regenerar todo desde cero (evitaría
// que el 2do intento elija una oferta/gancho distinta a la ya enviada,
// dejando los seguimientos inconsistentes con el correo 1 real).
// Función (no const fijo) — encontrado el 2026-09-16: al separar el tema
// de asunto por campaña (tiempo en Google Maps, dinero en Piloto LATAM),
// esto se había quedado fijo con el texto de LATAM sin importar qué
// campaña llamara a generarSeguimientos() con esEmpresa:false.
const construirJsonInstructionsSoloSeguimientos = (esEmpresa) => `

Ya se mandó un correo inicial (te lo doy abajo, ya con firma incluida — ignora la firma, solo úsalo como contexto). Genera SOLO los 2 seguimientos para ese mismo correo (día 7 y día 14), cada uno con su propio asunto y un ángulo distinto al correo original y entre sí — nunca repitas el gancho/oferta completo. Responde ÚNICAMENTE con un objeto JSON válido (sin markdown, sin \`\`\`) con exactamente estas 4 claves:
{
  ${esEmpresa ? REGLA_SEGUIMIENTOS : REGLA_SEGUIMIENTOS_GM}
}
No agregues ninguna clave adicional fuera de esas 4.`;

async function generarSeguimientos(cuerpoEmailOriginal, { esEmpresa = false } = {}) {
  const promptBase = esEmpresa ? construirPromptEmpresa(null) : PROSPECTING_SYSTEM_PROMPT;
  const script = await chatCompletionJSON({
    system: promptBase + construirJsonInstructionsSoloSeguimientos(esEmpresa),
    user: `Correo inicial ya enviado:\n\n${cuerpoEmailOriginal}`,
    maxTokens: 700,
  });
  await corregirAsuntosDelScript(script, `Correo inicial ya enviado: ${cuerpoEmailOriginal.slice(0, 200)}`, { esEmpresa });
  await corregirCifrasDelScript(script, `Correo inicial ya enviado: ${cuerpoEmailOriginal.slice(0, 200)}`);
  const lineaLanding = esEmpresa ? LINEA_LANDING_LATAM : LINEA_LANDING_GM;
  if (script.seguimiento1Asunto) script.seguimiento1Asunto = script.seguimiento1Asunto.trim();
  if (script.seguimiento1) script.seguimiento1 = script.seguimiento1.trim() + `\n\n${LINEA_DEMO_GRATIS}\n\n${lineaLanding}`;
  if (script.seguimiento2Asunto) script.seguimiento2Asunto = script.seguimiento2Asunto.trim();
  if (script.seguimiento2) script.seguimiento2 = script.seguimiento2.trim() + `\n\n${LINEA_DEMO_GRATIS}\n\n${lineaLanding}`;
  return script;
}

module.exports = { generarScript, generarScriptEmpresa, generarSeguimientos, lineaProductoLatam };

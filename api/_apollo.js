// Cliente de Apollo.io para el pipeline diario de Piloto LATAM (empresas
// medianas/grandes en Latinoamérica) — pedido explícito del usuario el
// 2026-09-07, mismo rol que _apify.js cumple para Google Maps.
//
// Verificado contra el spec real de Apollo (https://docs.apollo.io/openapi/
// apollo-rest-api.json) el 2026-09-07:
// - POST /mixed_people/api_search — búsqueda, GRATIS (0 créditos), pero
//   devuelve datos enmascarados (last_name_obfuscated, has_email:true sin
//   el correo real) — solo sirve para encontrar candidatos, no para
//   obtener el contacto real.
// - POST /people/match — "revela" el correo real de un candidato ya
//   encontrado (por su id de Apollo). Costaría 8 créditos EXTRA solo si se
//   manda reveal_phone_number=true (y en ese caso además exige un
//   webhook_url, porque el teléfono se entrega async). Confirmado el
//   2026-09-07 contra la página oficial de precios
//   (https://docs.apollo.io/docs/api-pricing) Y contra los 14 parámetros
//   reales del endpoint: reveal_phone_number, run_waterfall_phone,
//   run_waterfall_email y reveal_personal_emails son TODOS false por
//   default, y este archivo nunca los manda — revelarCorreo() solo manda
//   {id: personId}, así que ninguno de esos 4 puede activarse por
//   accidente. Sin ellos, el cargo posible es de máximo "1 crédito por
//   demográficos/correo" (un solo cargo combinado, no acumulable — la doc
//   oficial lo redacta con "o", nunca "más") si Apollo encuentra algo, o 0
//   si no encuentra nada. Pedido explícito del usuario: "el sistema solo
//   debe consumir un crédito exacto para obtener un lead nuevo... solo el
//   correo" — esto ya lo garantiza el request, no hace falta lógica
//   adicional para forzarlo.
const APOLLO_BASE_URL = "https://api.apollo.io/api/v1";

function headers() {
  return {
    "x-api-key": process.env.APOLLO_API_KEY,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

// Seniorities y locations calibrados contra los 407 contactos reales que ya
// tenía Piloto LATAM (CEOs, CIOs, fundadores, directores de empresas
// medianas/grandes).
const SENIORITIES_DECISORES = ["owner", "founder", "c_suite", "partner", "vp", "director"];

// Puestos específicos a buscar dentro de esas seniorities — pedido explícito
// del usuario el 2026-09-13: "adicional a ceo, debes buscar presidentes,
// vip [sic, VP], founders, cio, director de ti, o de it, director
// comercial, director de operaciones, puestos por el estilo". Antes solo se
// filtraba por seniority (owner/founder/c_suite/partner/vp/director), lo
// cual en la práctica hacía que Apollo devolviera sobre todo founder/CEO —
// confirmado con una prueba real de búsqueda gratis (0 créditos): de 25
// candidatos con seniorities solamente, ninguno tenía CIO/director de TI/
// director comercial/director de operaciones en el título, todo era
// founder/co-founder/CEO. Agregando person_titles[] con esta lista (probado
// también en real, 0 créditos) el resultado sí trae esos puestos (director
// de TI, CIO, director de operaciones, director comercial, etc.) sin
// quedarse sin candidatos: 17,409 resultados totales disponibles en México
// solo, de sobra para el volumen diario del cron. Apollo hace OR entre los
// valores de person_titles[] y coincidencia parcial/difusa contra el título
// real (así "IT Director" también encuentra "IT Director | IT Senior"),
// así que no hace falta enumerar cada variante exacta — se listan en
// español e inglés porque Apollo indexa perfiles en ambos idiomas según el
// país/empresa.
const TITULOS_DECISORES = [
  "President", "Presidente",
  "Vice President", "VP", "Vicepresidente",
  "Founder", "Co-Founder", "Fundador",
  "CIO", "Chief Information Officer",
  "IT Director", "Director of IT", "Director de TI", "Director de IT",
  "Commercial Director", "Director Comercial",
  "Operations Director", "Director de Operaciones",
];

// Perfil de la campaña Alianzas: empresas que ya venden tecnología a otras
// empresas, pero que pueden requerir un partner especializado en IA. No se
// usa para clínicas, negocios locales ni compradores finales de Qi-Vanta.
const SENIORITIES_ALIANZAS = ["owner", "founder", "c_suite", "partner", "vp", "head", "director"];
const TITULOS_ALIANZAS = [
  "CEO", "Chief Executive Officer", "Founder", "Co-Founder", "Fundador", "Socio", "Partner", "Managing Partner",
  "CTO", "Chief Technology Officer", "Director de Tecnología", "Director de TI", "IT Director",
  "Director Comercial", "Commercial Director", "Business Development", "Desarrollo de Negocios",
  "Partnerships", "Alianzas Estratégicas", "Director de Alianzas",
];
const PALABRAS_CLAVE_ALIANZAS = "software ERP CRM consultoría TI integrador cloud ciberseguridad desarrollo tecnología";

const PAISES_LATAM = [
  "mexico", "colombia", "argentina", "chile", "peru", "brazil", "ecuador",
  "uruguay", "paraguay", "bolivia", "costa rica", "panama", "guatemala",
  "honduras", "el salvador", "dominican republic", "venezuela",
];

// Pedido explícito del usuario el 2026-09-08, después de ver el primer
// lote de 197 (traía conglomerados como Grupo Bimbo, Grupo Salinas,
// Aeroméxico): "no quiero empresas tan grandes... deberan ser empresas
// chicas o medianas menos de 1000 empleados". Antes no había filtro de
// tamaño ("todo tipo de empresa" era el pedido original del 2026-09-04,
// esto lo reemplaza). Rangos en el formato exacto que pide Apollo
// (organization_num_employees_ranges[]): "min,max" por bucket.
const RANGOS_EMPLEADOS_PYME = ["1,10", "11,20", "21,50", "51,100", "101,200", "201,500", "501,1000"];

// Progresión automática de "niveles" para el cron diario — pedido
// explícito del usuario el 2026-09-08: "cuando termines de recorrer todo
// méxico menos de 1000 empleados brincaremos de 1000 a 2000, luego de 2
// mil a 3 mil, y luego iremos a otros países de latam y haremos lo
// mismo". Cada nivel es un país + una banda de tamaño de empresa; cuando
// un nivel se agota (buscarPersonas ya no encuentra candidatos ahí),
// cron-scrape-empresas.js avanza solo al siguiente nivel de esta lista —
// no hace falta pedirlo de nuevo cada vez. México va primero porque es
// donde se empezó.
const BANDAS_EMPLEADOS_PROGRESION = ["1,1000", "1001,2000", "2001,3000"];

const NIVELES_APOLLO = PAISES_LATAM.flatMap((pais) =>
  BANDAS_EMPLEADOS_PROGRESION.map((banda) => ({ pais, banda }))
);

async function buscarPersonas({ page = 1, perPage = 25, paises = PAISES_LATAM, rangosEmpleados = RANGOS_EMPLEADOS_PYME, seniorities = SENIORITIES_DECISORES, titulos = TITULOS_DECISORES, palabrasClave = "" } = {}) {
  const params = new URLSearchParams();
  for (const s of seniorities) params.append("person_seniorities[]", s);
  for (const t of titulos) params.append("person_titles[]", t);
  for (const p of paises) params.append("organization_locations[]", p);
  for (const r of rangosEmpleados) params.append("organization_num_employees_ranges[]", r);
  params.append("contact_email_status[]", "verified");
  if (palabrasClave) params.append("q_keywords", palabrasClave);
  params.append("page", String(page));
  params.append("per_page", String(perPage));

  const res = await fetch(`${APOLLO_BASE_URL}/mixed_people/api_search?${params.toString()}`, {
    method: "POST",
    headers: headers(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Apollo (búsqueda) respondió con error (${res.status}): ${JSON.stringify(data)}`);

  return {
    totalEncontrados: data.total_entries || 0,
    personas: (data.people || []).filter((p) => p.has_email), // descarta candidatos sin correo antes de gastar crédito revelándolos
  };
}

function buscarPersonasAlianzas({ page = 1, perPage = 25, paises = PAISES_LATAM, rangosEmpleados = RANGOS_EMPLEADOS_PYME } = {}) {
  return buscarPersonas({ page, perPage, paises, rangosEmpleados, seniorities: SENIORITIES_ALIANZAS, titulos: TITULOS_ALIANZAS, palabrasClave: PALABRAS_CLAVE_ALIANZAS });
}

// Revela el correo real de UN candidato ya encontrado en buscarPersonas().
// Nunca manda reveal_phone_number ni run_waterfall_* — mantiene el costo
// fijo en 1 crédito (0 si Apollo no tiene correo para esa persona).
async function revelarCorreo(personId) {
  const res = await fetch(`${APOLLO_BASE_URL}/people/match`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ id: personId }),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(`Apollo (revelar) respondió con error (${res.status}): ${JSON.stringify(data)}`);
    err.apolloCode = data?.error_details?.code || null; // ej. "BILLING.LIMIT.CREDITS_EXHAUSTED" — permite distinguir "sin créditos" de un error transitorio
    throw err;
  }

  const persona = data.person;
  if (!persona || !persona.email) return null;

  return {
    nombre: `${persona.first_name || ""} ${persona.last_name || ""}`.trim(),
    titulo: persona.title || "",
    correo: persona.email,
    empresa: persona.organization?.name || "",
    descripcionEmpresa: persona.organization?.short_description || null,
    // Sitio web de la empresa — agregado el 2026-09-26, pedido explícito
    // del usuario: antes de mandar cada correo de Piloto LATAM hay que
    // analizar el sitio de la empresa y anexar observaciones reales al
    // cuerpo (ver _analisisSitio.js). Sin este campo no había con qué.
    sitioWeb: persona.organization?.website_url || null,
    // Número real de empleados (no la banda de búsqueda) — pedido explícito
    // del usuario el 2026-09-10: el catálogo de ofertas para empresas de
    // más de 100 empleados debe ser distinto (SDLC/DevSecOps/modernización
    // enterprise) al de empresas más chicas dentro de la misma campaña. Ver
    // _prospectingPromptEnterprise.js.
    numEmpleados: persona.organization?.estimated_num_employees ?? null,
    apolloId: persona.id,
  };
}

// Consulta el saldo real de lead_credit (GRATIS, 0 créditos — verificado
// contra la doc oficial). Se usa antes y después de cada corrida del cron
// para poder comparar "créditos gastados" contra "leads producidos" con
// datos reales de Apollo, no solo con lo que este código dice que hizo —
// pedido explícito del usuario el 2026-09-08 tras el episodio de los 2,541
// créditos sin explicación clara: "como garantizas que no se gastarán en
// balde".
async function obtenerCreditosLead() {
  const res = await fetch(`${APOLLO_BASE_URL}/usage_stats/credit_usage_stats`, {
    method: "POST",
    headers: headers(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Apollo (créditos) respondió con error (${res.status}): ${JSON.stringify(data)}`);
  return data.credit_usage_stats?.lead_credit || null; // {limit, consumed, left_over}
}

module.exports = { buscarPersonas, buscarPersonasAlianzas, revelarCorreo, obtenerCreditosLead, NIVELES_APOLLO };

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
// medianas/grandes) — sin filtro de tamaño de empresa, pedido explícito
// del usuario: "todo tipo de empresa".
const SENIORITIES_DECISORES = ["owner", "founder", "c_suite", "partner", "vp", "director"];

const PAISES_LATAM = [
  "mexico", "colombia", "argentina", "chile", "peru", "brazil", "ecuador",
  "uruguay", "paraguay", "bolivia", "costa rica", "panama", "guatemala",
  "honduras", "el salvador", "dominican republic", "venezuela",
];

async function buscarPersonas({ page = 1, perPage = 25 } = {}) {
  const params = new URLSearchParams();
  for (const s of SENIORITIES_DECISORES) params.append("person_seniorities[]", s);
  for (const p of PAISES_LATAM) params.append("organization_locations[]", p);
  params.append("contact_email_status[]", "verified");
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
    apolloId: persona.id,
  };
}

module.exports = { buscarPersonas, revelarCorreo };

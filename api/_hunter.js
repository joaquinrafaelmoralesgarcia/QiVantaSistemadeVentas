// Cliente de Hunter.io — segunda fuente de contactos nuevos para Piloto
// LATAM, agregada el 2026-09-07 mientras se renuevan los créditos de
// Apollo (28 de septiembre). A diferencia de Apollo (busca PERSONAS por
// seniority/país), Hunter busca por DOMINIO de empresa ya conocido — por
// eso necesita una lista de dominios objetivo (ver _hunterDominios.js) en
// vez de poder descubrir candidatos por sí solo.
//
// Verificado el 2026-09-07 contra la documentación oficial de Hunter:
// - El plan gratis SÍ incluye acceso a la API (a diferencia de Snov.io,
//   Lusha, Kaspr y Adapt.io, que solo dan API en planes de paga) — 50
//   créditos/mes, compartidos con el uso desde la web.
// - Domain Search cuesta 1 crédito SI encuentra al menos 1 resultado (0 si
//   no encuentra nada), sin importar cuántos correos traiga esa consulta
//   (hasta 100 con limit=100) — 1 crédito puede traer decenas de correos
//   de una sola empresa grande.
// - 429 = se acabaron los créditos del mes (dejar de intentar, reintentar
//   el mismo dominio el próximo mes). 403 = límite de velocidad
//   transitorio, no significa que se acabaron los créditos.
// - Nunca se pide teléfono: Domain Search de Hunter no lo devuelve bajo
//   ningún parámetro, es una herramienta 100% de correo.
const HUNTER_BASE_URL = "https://api.hunter.io/v2";

async function buscarCorreosEnDominio(dominio, { limit = 100 } = {}) {
  const params = new URLSearchParams({
    domain: dominio,
    api_key: process.env.HUNTER_API_KEY,
    limit: String(limit),
  });

  const res = await fetch(`${HUNTER_BASE_URL}/domain-search?${params.toString()}`);
  const data = await res.json();

  if (!res.ok) {
    const err = new Error(`Hunter respondió con error (${res.status}): ${JSON.stringify(data.errors || data)}`);
    const idError = Array.isArray(data.errors) ? data.errors[0]?.id : data.errors?.id;
    err.cuentaRestringida = idError === "restricted_account"; // problema de la cuenta, no de créditos — hay que entrar a Hunter a resolverlo
    err.sinCreditos = res.status === 429 && !err.cuentaRestringida; // límite mensual agotado
    err.limiteDeVelocidad = res.status === 403; // transitorio, reintentar más tarde
    throw err;
  }

  const empresa = data.data?.organization || dominio;
  return (data.data?.emails || [])
    .filter((e) => e.value && e.first_name) // descarta buzones genéricos (info@, ventas@) sin nombre de persona real
    .map((e) => ({
      nombre: `${e.first_name || ""} ${e.last_name || ""}`.trim(),
      titulo: e.position || "",
      correo: e.value,
      empresa,
      dominio,
    }));
}

module.exports = { buscarCorreosEnDominio };

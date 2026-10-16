// Verificación básica de correo antes de mandarlo a Smartlead — pedido del
// usuario el 2026-09-04 tras ver su bandeja llena de "Mail Delivery
// Subsystem" (13 rebotes de 144 enviados en la campaña de Google Maps,
// ~9%). Apify scrapea cualquier email que encuentre en el sitio del
// negocio, sin garantía de que siga activo.
//
// Esto NO es verificación completa (no hace un handshake SMTP real, eso
// requeriría un servicio de pago tipo NeverBounce/ZeroBounce) — solo
// revisa formato + que el dominio tenga registros MX (acepta correo).
// Es gratis y sin dependencias nuevas, y descarta la parte más obvia:
// dominios que no existen o no tienen servidor de correo configurado.
const dns = require("dns").promises;

const FORMATO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIMEOUT_MS = 5000;

function conTimeout(promesa, ms) {
  return Promise.race([promesa, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

async function correoTieneServidorValido(correo) {
  if (!correo || !FORMATO_VALIDO.test(correo)) return false;

  const dominio = correo.split("@")[1];
  try {
    const registrosMx = await conTimeout(dns.resolveMx(dominio), TIMEOUT_MS);
    return Array.isArray(registrosMx) && registrosMx.length > 0;
  } catch (err) {
    // ENOTFOUND/ENODATA -> el dominio no existe o no acepta correo.
    // Cualquier otro error (timeout, DNS caído) -> mejor no descartar el
    // lead por un problema nuestro, se deja pasar.
    if (err?.code === "ENOTFOUND" || err?.code === "ENODATA") return false;
    return true;
  }
}

// Verificacion de entregabilidad con MillionVerifier (agregado 2026-10-16).
// Los caminos de captacion (Apify y Apollo/Hunter) subian leads directo a
// Smartlead sin verificar: en 72h entraron 42 asi, contra 61 por el cron de
// carga. ok -> se puede cargar; invalid/disposable/catch_all/unknown -> no.
// Si no hay API key, no hay creditos o la API falla, devuelve ok:true: un
// problema del verificador nunca debe frenar la captacion (la regla completa
// la sigue aplicando scripts/cron-cargar-leads.js, que reclasifica los leads
// que quedan en "error").
async function verificarEntregable(correo) {
  const key = process.env.MILLIONVERIFIER_API_KEY;
  if (!key || !correo) return { ok: true, resultado: null };
  try {
    const res = await conTimeout(fetch(`https://api.millionverifier.com/api/v3/?api=${encodeURIComponent(key)}&email=${encodeURIComponent(correo)}&timeout=10`), 12000);
    const data = await res.json();
    if (!res.ok || data.error || !data.result) return { ok: true, resultado: null };
    return { ok: data.result === "ok", resultado: data.result };
  } catch {
    return { ok: true, resultado: null };
  }
}

module.exports = { correoTieneServidorValido, verificarEntregable };

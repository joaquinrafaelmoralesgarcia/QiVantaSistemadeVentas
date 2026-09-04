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

module.exports = { correoTieneServidorValido };

// Extrae un correo GENERICO de la propia empresa (info@, contacto@, etc.)
// leyendo su sitio web — pedido explícito del usuario el 2026-10-08, tras
// ver 68% de rebote en Alianzas con correos PERSONALES adivinados por
// Apollo (patrón nombre.apellido@dominio, revelado por /people/match sin
// garantía real de que exista).
//
// POR QUE un buzón genérico rebota menos que uno adivinado: lo publica la
// propia empresa en su sitio como canal de contacto, así que alguien lo
// revisa activamente — no es una conjetura sobre qué dirección podría
// tener un empleado. No es perfecto (una empresa puede dejar de revisarlo),
// pero es consistentemente más confiable que un patrón adivinado.
//
// Solo acepta el correo si su dominio coincide con el del sitio que se
// analizó — nunca toma una dirección de un widget de terceros (chat, CRM
// embebido, anuncio) que casualmente aparezca en el HTML.
const dns = require("dns").promises;

const TIMEOUT_FETCH_MS = 8000;
const MAX_CARACTERES_SITIO = 40000; // más que _analisisSitio.js: aquí se busca en el HTML crudo (mailto:), no en texto plano

// Orden de preferencia — un alias de "contacto general" vale más que uno
// departamental, que vale más que un alias ambiguo.
const PREFIJOS_PREFERIDOS = [
  "info", "contacto", "contact", "hola", "hello",
  "ventas", "sales", "comercial", "administracion", "admin",
  "atencion", "soporte", "support",
];

const REGEX_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function dominioDe(url) {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; }
}

async function descargarHtml(url) {
  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), TIMEOUT_FETCH_MS);
  try {
    const res = await fetch(url, {
      signal: controlador.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; QiVantaBot/1.0)" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    return html.slice(0, MAX_CARACTERES_SITIO);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Páginas típicas de contacto — si la home no trae el correo, vale la pena
// probar /contacto o /contact antes de rendirse (1 intento extra, no más).
const RUTAS_CONTACTO = ["/contacto", "/contact", "/contact-us", "/about", "/acerca"];

function extraerCorreos(html, dominioEsperado) {
  const encontrados = (html.match(REGEX_EMAIL) || [])
    .map((e) => e.toLowerCase())
    .filter((e) => e.split("@")[1] === dominioEsperado) // descarta correos de terceros (gmail genérico, widgets, etc.)
    .filter((e) => !/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(e)); // basura de atributos srcset/alt mal parseados
  return [...new Set(encontrados)];
}

function elegirMejor(correos) {
  for (const prefijo of PREFIJOS_PREFERIDOS) {
    const match = correos.find((c) => c.split("@")[0] === prefijo);
    if (match) return match;
  }
  return correos[0] || null;
}

async function tieneServidorValido(correo) {
  try {
    const mx = await dns.resolveMx(correo.split("@")[1]);
    return Array.isArray(mx) && mx.length > 0;
  } catch {
    return false;
  }
}

// Devuelve { correo, fuente } o null si no encontró nada confiable.
async function extraerCorreoGenerico(sitioWeb) {
  if (!sitioWeb || typeof sitioWeb !== "string") return null;
  const dominio = dominioDe(sitioWeb);
  if (!dominio) return null;

  const base = sitioWeb.replace(/\/+$/, "");
  const candidatos = [sitioWeb, ...RUTAS_CONTACTO.map((r) => `${base}${r}`)];

  for (const url of candidatos) {
    const html = await descargarHtml(url);
    if (!html) continue;
    const correos = extraerCorreos(html, dominio);
    const mejor = elegirMejor(correos);
    if (mejor && (await tieneServidorValido(mejor))) {
      return { correo: mejor, fuente: url };
    }
  }
  return null;
}

module.exports = { extraerCorreoGenerico };

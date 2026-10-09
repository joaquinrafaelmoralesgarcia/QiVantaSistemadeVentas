// Sube SOLO, cada dia, el tope de envios por buzon de los buzones nuevos de
// SmartSenders, hasta llegar a 40/dia — pedido explicito del usuario el
// 2026-10-01: "debes configurar el warm up para que poco a poco vayamos
// alcanzando los envios de 40 leads diarios por cuenta como minimo".
//
// Curva: 5/dia el dia 0, +1.25/dia, 40/dia el dia 28. Es la ventana de
// 3-4 semanas que recomiendan las guias de infraestructura de correo frio
// (arrancar con 5-10/dia y llegar a 30-50 en 21-28 dias).
//
// COMPUERTA DE SALUD: si el buzon tiene SMTP roto, correos marcados como
// spam o reputacion de warmup baja, el tope se CONGELA donde esta — nunca
// sigue subiendo sobre un buzon enfermo. Llegar a 40 en 5 semanas es mejor
// que llegar en 4 con el dominio quemado (justo lo que paso con Google).
// Nunca BAJA un tope por su cuenta: solo congela o sube.
//
//   node scripts/rampa-envios.js          # ejecuta
//   node scripts/rampa-envios.js --dry    # solo muestra que haria
const fs = require("fs");
const path = require("path");
const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

const DRY = process.argv.includes("--dry");
const KEY = process.env.SMARTLEAD_API_KEY;
const BASE = "https://server.smartlead.ai/api/v1";

const DOMINIOS_VIEJOS = ["qi-vanta.com", "qi-vantatech.com"];
const TOPE_INICIAL = 5;
const TOPE_META = 40;
const DIAS_PARA_META = 28;
// El tope de la cuenta es TOTAL: lo comparten warmup y campanas. Para que a
// las campanas les queden TOPE_META, el tope escrito debe ser
// TOPE_META + WARMUP_RESERVADO. Sin esta reserva el warmup se come el tope y
// las campanas quedan en cero envios (bug real del 2026-10-07).
const WARMUP_RESERVADO = 10;
// Tasa de rebote por campana a partir de la cual se CONGELA el tope. El
// 2026-10-07 Alianzas llego a 55% de rebote y esta rampa habria seguido
// subiendo, porque solo miraba SMTP/spam/reputacion y nunca el rebote.
const REBOTE_MAXIMO = 3; // %
const MINIMO_ENVIADOS_PARA_JUZGAR = 10; // por debajo de esto la tasa es ruido
const DIAS_DE_GRACIA_REPUTACION = 14;
const REPUTACION_MINIMA = 70; // % de warmup_reputation por debajo del cual se congela

function topeParaDia(dias) {
  const t = TOPE_INICIAL + ((TOPE_META - TOPE_INICIAL) * Math.max(0, dias)) / DIAS_PARA_META;
  const metaCampana = Math.min(TOPE_META, Math.round(t));
  return metaCampana + WARMUP_RESERVADO;
}

async function api(metodo, ruta, cuerpo) {
  const sep = ruta.includes("?") ? "&" : "?";
  const res = await fetch(`${BASE}${ruta}${sep}api_key=${encodeURIComponent(KEY)}`, {
    method: metodo,
    headers: { "Content-Type": "application/json" },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

// Devuelve el motivo por el que NO se debe subir, o null si esta sano.
// Peor tasa de rebote entre las campanas a las que sirve este buzon. Si
// cualquiera esta por encima del umbral, no se sube el tope de nadie: un
// rebote alto quema el dominio, no solo la campana.
async function peorRebote() {
  const campanas = await api("GET", "/campaigns");
  let peor = { tasa: 0, nombre: null };
  for (const c of (Array.isArray(campanas.json) ? campanas.json : [])) {
    if (c.status !== "ACTIVE") continue;
    const an = await api("GET", `/campaigns/${c.id}/analytics`);
    const enviados = Number(an.json?.sent_count || 0);
    const rebotes = Number(an.json?.bounce_count || 0);
    if (enviados < MINIMO_ENVIADOS_PARA_JUZGAR) continue;
    const tasa = (100 * rebotes) / enviados;
    if (tasa > peor.tasa) peor = { tasa, nombre: c.name };
  }
  return peor;
}

function motivoDeCongelacion(a, dias, peor) {
  if (peor && peor.tasa > REBOTE_MAXIMO) return `rebote ${peor.tasa.toFixed(1)}% en "${peor.nombre}" (> ${REBOTE_MAXIMO}%)`;
  if (!a.is_smtp_success) return "SMTP roto";
  const w = a.warmup_details || {};
  // El warmup APAGADO a proposito no es un buzon enfermo. Se apago el
  // 2026-10-07 porque su techo (40/dia) se comia el tope total de la cuenta
  // (40/dia) y dejaba a las campanas en cero envios — ver
  // scripts/apagar-warmup-cuentas.js. Solo un warmup BLOQUEADO por Smartlead
  // (senal real de reputacion mala) debe congelar el tope.
  if (w.status && !["ACTIVE", "INACTIVE", "PAUSED"].includes(w.status)) return `warmup ${w.status}`;
  if (w.is_warmup_blocked || w.blocked_reason) return `warmup bloqueado (${w.blocked_reason || "sin motivo"})`;
  if ((w.total_spam_count || 0) > 0) return `${w.total_spam_count} correo(s) marcados como spam`;
  // La reputacion de un buzon NUEVO empieza en 0% y se construye con las
  // semanas: evaluarla desde el dia 0 congelaria todos los topes para siempre
  // (encontrado el 2026-10-02 en la primera simulacion real). Solo cuenta
  // pasados los dias de gracia.
  const rep = parseFloat(String(w.warmup_reputation ?? "").replace("%", ""));
  if (dias >= DIAS_DE_GRACIA_REPUTACION && !Number.isNaN(rep) && rep < REPUTACION_MINIMA) return `reputacion ${rep}% (< ${REPUTACION_MINIMA}%)`;
  return null;
}

(async () => {
  const lista = await api("GET", "/email-accounts/?offset=0&limit=100");
  const cuentas = (Array.isArray(lista.json) ? lista.json : []).filter((a) => {
    const dominio = ((a.from_email || "").split("@")[1] || "").toLowerCase();
    return !DOMINIOS_VIEJOS.includes(dominio);
  });

  console.log(`${DRY ? "SIMULACION" : "EJECUTANDO"} rampa — buzones nuevos: ${cuentas.length}`);
  if (!cuentas.length) { console.log("Aun no hay buzones nuevos."); return; }

  const peor = await peorRebote();
  if (peor.nombre) console.log(`peor rebote entre campanas activas: ${peor.tasa.toFixed(1)}% ("${peor.nombre}")`);
  let subidos = 0, congelados = 0, enMeta = 0;
  for (const a of cuentas) {
    const creada = new Date(a.created_at);
    const dias = Math.floor((Date.now() - creada.getTime()) / 86400000);
    const deseado = topeParaDia(dias);
    const actual = a.message_per_day || 0; // se ESCRIBE con max_email_per_day, pero se LEE en message_per_day

    const motivo = motivoDeCongelacion(a, dias, peor);
    if (motivo) {
      console.log(`CONGELADO ${a.from_email}: ${motivo} (se queda en ${actual}/dia, le tocaria ${deseado})`);
      congelados++;
      continue;
    }
    if (deseado <= actual) {
      console.log(`ok ${a.from_email}: ${actual}/dia (dia ${dias}, objetivo del dia ${deseado})${actual >= TOPE_META + WARMUP_RESERVADO ? " — META ALCANZADA" : ""}`);
      if (actual >= TOPE_META + WARMUP_RESERVADO) enMeta++;
      continue;
    }
    console.log(`SUBE ${a.from_email}: ${actual} -> ${deseado}/dia (dia ${dias})`);
    if (!DRY) {
      const r = await api("POST", `/email-accounts/${a.id}`, { max_email_per_day: deseado });
      if (!r.ok) { console.error(`  error ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`); continue; }
    }
    subidos++;
  }
  console.log(`=== subidos: ${subidos} | congelados por salud: ${congelados} | en meta (${TOPE_META} campana + ${WARMUP_RESERVADO} warmup): ${enMeta} de ${cuentas.length} ===`);
  // Un buzon congelado debe verse en rojo en GitHub Actions, no pasar en silencio.
  if (congelados > 0) process.exitCode = 1;
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });

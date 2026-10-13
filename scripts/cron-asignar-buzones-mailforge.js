// Asigna solo, en la nube, los buzones de Mailforge a su campana cuando ya
// cumplieron el warmup y estan sanos. Sin esto la asignacion dependeria de
// que alguien se acuerde de hacerla el dia 14.
//
// REGLAS (todas deben cumplirse por buzon):
//   - Al menos 14 dias desde que se dio de alta en Smartlead (recomendacion de
//     Smartlead y de Mailforge: ~2 semanas de warmup antes de campanas vivas).
//   - SMTP e IMAP conectados, warmup ACTIVE, 0 correos marcados como spam y
//     reputacion de warmup >= 70%.
//   - Que no este ya asignado a esa campana (idempotente: correrlo de nuevo no
//     duplica nada).
// Un buzon que no cumple se omite y se reintenta en la siguiente corrida.
//
// MAPA, un dominio por campana (la reputacion se mide por dominio, no se
// mezclan campanas en un mismo dominio):
//   Piloto LATAM : qi-vantaconnect.com, qi-vantaworks.com, qi-vantalabs.com
//   Google Maps  : qi-vantapro.com, qi-vantadirect.com
// Laboratorios y Alianzas no reciben buzones nuevos (estan pausadas por rebote).
//
// Despues de asignar, el canario diario (canario-entrega.js) sigue probando
// cada buzon y lo retira de las campanas si Microsoft/Google lo bloquea, y
// rampa-envios.js controla el tope diario (curva lenta para estos dominios).
//
// Vive en la nube: .github/workflows/cron-asignar-buzones-mailforge.yml.
//   node scripts/cron-asignar-buzones-mailforge.js          # ejecuta
//   node scripts/cron-asignar-buzones-mailforge.js --dry    # solo muestra
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

const PILOTO = "4093533";
const GOOGLE_MAPS = "4093547";
const CAMPANA_POR_DOMINIO = {
  "qi-vantaconnect.com": PILOTO,
  "qi-vantaworks.com": PILOTO,
  "qi-vantalabs.com": PILOTO,
  "qi-vantapro.com": GOOGLE_MAPS,
  "qi-vantadirect.com": GOOGLE_MAPS,
};
const DIAS_DE_WARMUP = 14;
const REPUTACION_MINIMA = 70;

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

// Motivo por el que NO se debe asignar todavia, o null si esta listo.
function motivoDeEspera(a) {
  const dias = Math.floor((Date.now() - new Date(a.created_at).getTime()) / 86400000);
  if (dias < DIAS_DE_WARMUP) return `${dias} dias de warmup, faltan ${DIAS_DE_WARMUP - dias}`;
  if (!a.is_smtp_success || !a.is_imap_success) return "SMTP o IMAP desconectado";
  const w = a.warmup_details || {};
  if (w.status !== "ACTIVE") return `warmup ${w.status || "sin estado"} (debe estar ACTIVE)`;
  if ((w.total_spam_count || 0) > 0) return `${w.total_spam_count} correo(s) de warmup en spam`;
  const rep = parseFloat(String(w.warmup_reputation ?? "").replace("%", ""));
  if (Number.isNaN(rep) || rep < REPUTACION_MINIMA) return `reputacion ${w.warmup_reputation ?? "?"} (< ${REPUTACION_MINIMA}%)`;
  return null;
}

(async () => {
  const lista = await api("GET", "/email-accounts/?offset=0&limit=100");
  const cuentas = (Array.isArray(lista.json) ? lista.json : []).filter((a) => CAMPANA_POR_DOMINIO[((a.from_email || "").split("@")[1] || "").toLowerCase()]);
  console.log(`${DRY ? "SIMULACION" : "EJECUTANDO"} asignacion de buzones Mailforge — ${cuentas.length} buzones`);

  const asignadasPorCampana = new Map();
  let asignados = 0, esperando = 0, yaEstaban = 0;
  for (const a of cuentas) {
    const dominio = a.from_email.split("@")[1].toLowerCase();
    const campanaId = CAMPANA_POR_DOMINIO[dominio];
    if (!asignadasPorCampana.has(campanaId)) {
      const r = await api("GET", `/campaigns/${campanaId}/email-accounts`);
      asignadasPorCampana.set(campanaId, new Set((Array.isArray(r.json) ? r.json : []).map((x) => x.id)));
    }
    if (asignadasPorCampana.get(campanaId).has(a.id)) { yaEstaban++; continue; }

    const motivo = motivoDeEspera(a);
    if (motivo) { console.log(`espera ${a.from_email}: ${motivo}`); esperando++; continue; }

    console.log(`ASIGNA ${a.from_email} -> campana ${campanaId}`);
    if (!DRY) {
      const r = await api("POST", `/campaigns/${campanaId}/email-accounts`, { email_account_ids: [a.id] });
      if (!r.ok) { console.error(`  error ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`); continue; }
    }
    asignados++;
  }
  console.log(`=== asignados: ${asignados} | esperando: ${esperando} | ya estaban: ${yaEstaban} ===`);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });

// Apaga el warmup de Smartlead en los buzones de envio y deja el tope diario
// completo (40/dia) disponible para las campanas.
//
// POR QUE: el 2026-10-07 se detecto que NINGUNA campana habia enviado un solo
// correo (sent_count 0 en las 4, con 1104 borradores generados y los leads
// atascados en notStarted). La causa no era configuracion de campana sino
// CAPACIDAD: el tope de la cuenta (message_per_day = 40) es un tope TOTAL que
// se comparte con el warmup, y el warmup habia rampeado hasta 35-44/dia con
// techo 40 — es decir, se comia el 100% del tope y a las campanas les quedaba
// cero. El rampa-envios.js subio max_email_per_day a 40 tratandolo como meta
// de campana, pero ese 40 nunca fue exclusivo de campanas.
//
// CONFIRMADO en vivo el 2026-10-07: al subir el tope de los 2 buzones de
// Piloto de 40 a 80, la campana empezo a enviar en 90 segundos (sent 0 -> 2)
// y el daily_sent_count de esos 2 buzones paso de 40 a 41. El tope estaba
// genuinamente agotado por el warmup; no era un problema de configuracion.
//
// Decision del usuario el 2026-10-07: apagar el warmup y dejar los 40/dia
// integros para campana, para cumplir el minimo de 40 correos por cuenta.
//
//   node scripts/apagar-warmup-cuentas.js          # simulacion
//   node scripts/apagar-warmup-cuentas.js --apply  # ejecuta
const fs = require("fs");
const path = require("path");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const APPLY = process.argv.includes("--apply");
const KEY = process.env.SMARTLEAD_API_KEY;
const BASE = "https://server.smartlead.ai/api/v1";
const TOPE_CAMPANA = 40; // minimo de correos de campana por cuenta y por dia

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

(async () => {
  const lista = await api("GET", "/email-accounts/?offset=0&limit=100");
  const cuentas = Array.isArray(lista.json) ? lista.json : [];
  console.log(`${APPLY ? "EJECUTANDO" : "SIMULACION"} — buzones: ${cuentas.length}`);

  for (const a of cuentas) {
    const w = a.warmup_details || {};
    console.log(`${a.from_email}: warmup=${w.status || "?"} (techo ${w.max_email_per_day ?? "?"}/dia) tope=${a.message_per_day}/dia -> warmup OFF, tope ${TOPE_CAMPANA}/dia`);
    if (!APPLY) continue;
    const off = await api("POST", `/email-accounts/${a.id}/warmup`, { warmup_enabled: false });
    const tope = await api("POST", `/email-accounts/${a.id}`, { max_email_per_day: TOPE_CAMPANA });
    console.log(`  warmup ${off.status}${off.ok ? "" : " " + JSON.stringify(off.json).slice(0, 120)} | tope ${tope.status}${tope.ok ? "" : " " + JSON.stringify(tope.json).slice(0, 120)}`);
  }
  console.log(APPLY ? "LISTO" : `\nCon --apply: apaga warmup y fija tope ${TOPE_CAMPANA}/dia en las ${cuentas.length} cuentas.`);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });

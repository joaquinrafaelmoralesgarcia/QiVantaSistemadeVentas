// Ajusta el tope diario de envios (max_email_per_day) de todos los buzones.
//
// POR QUE: el tope de una cuenta es TOTAL y se comparte con el warmup. El
// 2026-10-07 el warmup (techo 40) se comia los 40/dia del tope y las campanas
// quedaban en cero envios — ver scripts/apagar-warmup-cuentas.js. Con el
// warmup ya apagado, el tope es capacidad de campana pura, PERO el contador
// diario (daily_sent_count) no se reinicia hasta el dia siguiente: para
// recuperar un dia ya consumido por el warmup hay que subir el tope.
//
// Pedido explicito del usuario el 2026-10-07: subir a 80 para que salieran
// correos ESE mismo dia, aceptando que son 80/dia desde dominios de 5 dias.
// Para volver al minimo acordado de 40 de campana por cuenta:
//   node scripts/ajustar-tope-envios.js --tope 40 --apply
//
// OJO: scripts/rampa-envios.js nunca BAJA un tope (solo congela o sube), asi
// que un tope alto se queda puesto hasta que se baje con este script.
//
//   node scripts/ajustar-tope-envios.js --tope 80          # simulacion
//   node scripts/ajustar-tope-envios.js --tope 80 --apply  # ejecuta
const fs = require("fs");
const path = require("path");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const i = args.indexOf("--tope");
const TOPE = i >= 0 && args[i + 1] ? Number(args[i + 1]) : NaN;
if (!Number.isInteger(TOPE) || TOPE < 1 || TOPE > 200) {
  console.error("Uso: node scripts/ajustar-tope-envios.js --tope <1-200> [--apply]");
  process.exit(1);
}

const BASE = "https://server.smartlead.ai/api/v1";
async function api(metodo, ruta, cuerpo) {
  const sep = ruta.includes("?") ? "&" : "?";
  const r = await fetch(`${BASE}${ruta}${sep}api_key=${encodeURIComponent(process.env.SMARTLEAD_API_KEY)}`, {
    method: metodo, headers: { "Content-Type": "application/json" }, body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json };
}

(async () => {
  const lista = await api("GET", "/email-accounts/?offset=0&limit=100");
  const cuentas = Array.isArray(lista.json) ? lista.json : [];
  console.log(`${APPLY ? "EJECUTANDO" : "SIMULACION"} — tope ${TOPE}/dia en ${cuentas.length} buzon(es)`);
  for (const a of cuentas) {
    console.log(`  ${a.from_email.padEnd(42)} ${a.message_per_day} -> ${TOPE} (enviados hoy ${a.daily_sent_count})`);
    if (!APPLY) continue;
    const r = await api("POST", `/email-accounts/${a.id}`, { max_email_per_day: TOPE });
    if (!r.ok) console.error(`    error ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
  }
  if (!APPLY) { console.log("\nCon --apply lo aplica."); return; }

  const v = await api("GET", "/email-accounts/?offset=0&limit=100");
  let libre = 0;
  console.log("\n=== capacidad libre HOY ===");
  for (const a of (Array.isArray(v.json) ? v.json : [])) {
    const l = Math.max(0, a.message_per_day - a.daily_sent_count);
    libre += l;
    console.log(`  ${a.from_email.padEnd(42)} ${a.daily_sent_count}/${a.message_per_day} libre=${l} warmup=${(a.warmup_details || {}).status}`);
  }
  console.log(`\nCAPACIDAD LIBRE HOY: ${libre} correos`);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });

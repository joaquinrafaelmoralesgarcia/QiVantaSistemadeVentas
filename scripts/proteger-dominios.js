// Baja el riesgo de quemar los dominios nuevos: reactiva el warmup a volumen
// BAJO, recorta el tope diario y espacia los envios.
//
// POR QUE (2026-10-07): tras desbloquear el envio, la tasa de rebote salio en
// 16.7% global (Alianzas 43.8%, Laboratorios 18.8%, Piloto 0%). Lo que se
// descarto investigando:
//   - Autenticacion: SPF (-all), DKIM (selectores de Microsoft) y DMARC
//     (p=reject) estan CORRECTOS en los 3 dominios de envio.
//   - Listas sucias: los 11 dominios que rebotaron TIENEN MX valido, asi que
//     correoTieneServidorValido() no habria cazado ninguno.
//   - Buzon quemado: ninguna cuenta esta marcada (reputacion 98-100%, 0 spam).
//   - Verificacion real de buzon: no hay. Hunter devuelve 429
//     "restricted_account" y Apollo esta en 0 creditos.
// Smartlead marco sender_bounce=true en 8 de 11, o sea atribuye el rebote al
// remitente. Con buzones de 5 dias de vida, la palanca que queda es bajar el
// ritmo y devolverles la senal de reputacion que da el warmup.
//
// OJO: el warmup vuelve a 10/dia, NO a los 35-40 que tenia. A 40 se comia el
// tope completo de la cuenta y dejaba las campanas en cero envios (el bug que
// se arreglo este mismo dia, ver apagar-warmup-cuentas.js). A 10/dia construye
// reputacion y deja ~40 para campana con tope 50.
//
//   node scripts/proteger-dominios.js          # simulacion
//   node scripts/proteger-dominios.js --apply  # ejecuta
const fs = require("fs");
const path = require("path");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const APPLY = process.argv.includes("--apply");
const BASE = "https://server.smartlead.ai/api/v1";

const WARMUP_POR_DIA = 10;   // bajo a proposito: reputacion sin comerse el tope
const TOPE_DIARIO = 50;      // 50 - 10 de warmup = ~40 de campana (el minimo pedido)
const MINUTOS_ENTRE_ENVIOS = 10; // antes 3: espacia el envio en la ventana
const LEADS_NUEVOS_POR_DIA = 40; // antes 80: la mitad de leads nuevos al dia

const CAMPANAS = [["Piloto LATAM", "4093533"], ["Alianzas", "4093546"], ["Google Maps", "4093547"], ["Laboratorios", "4093548"]];

async function api(metodo, ruta, cuerpo) {
  const sep = ruta.includes("?") ? "&" : "?";
  const r = await fetch(`${BASE}${ruta}${sep}api_key=${encodeURIComponent(process.env.SMARTLEAD_API_KEY)}`, {
    method: metodo, headers: { "Content-Type": "application/json" }, body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json };
}

(async () => {
  console.log(`${APPLY ? "EJECUTANDO" : "SIMULACION"} proteccion de dominios`);
  console.log(`  warmup ${WARMUP_POR_DIA}/dia | tope ${TOPE_DIARIO}/dia | ${MINUTOS_ENTRE_ENVIOS} min entre envios | ${LEADS_NUEVOS_POR_DIA} leads nuevos/dia\n`);

  const lista = await api("GET", "/email-accounts/?offset=0&limit=100");
  for (const a of (Array.isArray(lista.json) ? lista.json : [])) {
    const w = a.warmup_details || {};
    console.log(`${a.from_email.padEnd(42)} tope ${a.message_per_day}->${TOPE_DIARIO} | warmup ${w.status}->ACTIVE(${WARMUP_POR_DIA}/dia)`);
    if (!APPLY) continue;
    const t = await api("POST", `/email-accounts/${a.id}`, { max_email_per_day: TOPE_DIARIO });
    let wr = await api("POST", `/email-accounts/${a.id}/warmup`, { warmup_enabled: true, total_warmup_per_day: WARMUP_POR_DIA, daily_rampup: 0, reply_rate_percentage: 30 });
    if (!wr.ok) wr = await api("POST", `/email-accounts/${a.id}/warmup`, { warmup_enabled: true, total_warmup_per_day: WARMUP_POR_DIA });
    console.log(`    tope ${t.status} | warmup ${wr.status}${wr.ok ? "" : " " + JSON.stringify(wr.json).slice(0, 120)}`);
  }

  console.log("\n=== cadencia de campanas ===");
  for (const [nombre, id] of CAMPANAS) {
    console.log(`${nombre}: ${MINUTOS_ENTRE_ENVIOS} min entre envios, ${LEADS_NUEVOS_POR_DIA} leads nuevos/dia`);
    if (!APPLY) continue;
    const r = await api("POST", `/campaigns/${id}/schedule`, {
      timezone: "America/Mexico_City", days_of_the_week: [1, 2, 3, 4, 5],
      start_hour: "08:00", end_hour: "19:00",
      min_time_btw_emails: MINUTOS_ENTRE_ENVIOS, max_new_leads_per_day: LEADS_NUEVOS_POR_DIA,
    });
    console.log(`  schedule ${r.status}${r.ok ? "" : " " + JSON.stringify(r.json).slice(0, 140)}`);
  }

  if (!APPLY) { console.log("\nCon --apply lo aplica."); return; }

  console.log("\n=== verificacion ===");
  const v = await api("GET", "/email-accounts/?offset=0&limit=100");
  for (const a of (Array.isArray(v.json) ? v.json : [])) {
    const w = a.warmup_details || {};
    console.log(`  ${a.from_email.padEnd(42)} ${a.daily_sent_count}/${a.message_per_day} warmup=${w.status} techo=${w.max_email_per_day}`);
  }
  for (const [nombre, id] of CAMPANAS) {
    const c = await api("GET", `/campaigns/${id}`);
    console.log(`  ${nombre.padEnd(14)} ${c.json.status} | ${c.json.min_time_btwn_emails} min | ${c.json.max_leads_per_day} leads/dia`);
  }
})().catch((e) => { console.error("ERR", e.stack || e.message); process.exit(1); });

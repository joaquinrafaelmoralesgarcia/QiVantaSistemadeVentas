// Convierte la secuencia de la campana Laboratorios (4093548) a merge tags
// por lead y la reactiva.
//
// POR QUE: la creo crear-campana-laboratorios.js con copy FIJO escrito a mano
// (solo {{first_name}} y {{company_name}}), asi que los 32 leads recibirian
// todos el mismo correo. Las otras 3 campanas usan {{qi_vanta_*}}, que
// Smartlead rellena con el copy que DeepInfra genera por empresa.
//
// Pedido explicito del usuario el 2026-10-07: "todos los copys obtenlos de
// deep infra segun el analisis que se haga de cada empresa". Sin esta
// conversion, el copy por empresa ya generado para los 32 leads de
// laboratorios nunca llegaria al destinatario.
//
//   node scripts/convertir-secuencia-laboratorios.js          # simulacion
//   node scripts/convertir-secuencia-laboratorios.js --apply  # ejecuta
const fs = require("fs");
const path = require("path");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const APPLY = process.argv.includes("--apply");
const ID = "4093548";
const BASE = "https://server.smartlead.ai/api/v1";

// Mismos cuerpos que Piloto/Alianzas/Google Maps: un solo merge tag por paso,
// con white-space:pre-wrap para que los saltos de linea del copy se respeten.
const SECUENCIAS = [
  { seq_number: 1, seq_delay_details: { delay_in_days: 0 }, subject: "{{qi_vanta_subject}}", email_body: `<div style="white-space:pre-wrap">{{qi_vanta_message}}</div>` },
  { seq_number: 2, seq_delay_details: { delay_in_days: 7 }, subject: "{{qi_vanta_followup1_subject}}", email_body: `<div style="white-space:pre-wrap">{{qi_vanta_followup1}}</div>` },
  { seq_number: 3, seq_delay_details: { delay_in_days: 7 }, subject: "{{qi_vanta_followup2_subject}}", email_body: `<div style="white-space:pre-wrap">{{qi_vanta_followup2}}</div>` },
];

async function api(metodo, ruta, cuerpo) {
  const sep = ruta.includes("?") ? "&" : "?";
  const r = await fetch(`${BASE}${ruta}${sep}api_key=${encodeURIComponent(process.env.SMARTLEAD_API_KEY)}`, {
    method: metodo, headers: { "Content-Type": "application/json" }, body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json };
}

(async () => {
  const antes = await api("GET", `/campaigns/${ID}/sequences`);
  const campana = await api("GET", `/campaigns/${ID}`);
  console.log(`${APPLY ? "EJECUTANDO" : "SIMULACION"} — campana ${ID} (${campana.json.name}), estado ${campana.json.status}`);
  console.log("\nsecuencia actual:");
  for (const p of (antes.json || [])) console.log(`  paso ${p.seq_number}: ${JSON.stringify(p.subject)}`);
  console.log("\nsecuencia nueva:");
  for (const p of SECUENCIAS) console.log(`  paso ${p.seq_number}: ${JSON.stringify(p.subject)}`);

  if (!APPLY) {
    console.log("\nCon --apply: guarda la secuencia nueva y pone la campana en START.");
    return;
  }

  const guardado = await api("POST", `/campaigns/${ID}/sequences`, { sequences: SECUENCIAS });
  console.log(`\nguardar secuencia: ${guardado.status} ${JSON.stringify(guardado.json).slice(0, 160)}`);
  const arranque = await api("POST", `/campaigns/${ID}/status`, { status: "START" });
  console.log(`arrancar campana: ${arranque.status}`);

  const verifSeq = await api("GET", `/campaigns/${ID}/sequences`);
  const verifCamp = await api("GET", `/campaigns/${ID}`);
  console.log("\n=== verificacion ===");
  for (const p of (verifSeq.json || [])) console.log(`  paso ${p.seq_number}: ${JSON.stringify(p.subject)} | body: ${JSON.stringify((p.email_body || "").slice(0, 60))}`);
  console.log(`  estado campana: ${verifCamp.json.status}`);
})().catch((e) => { console.error("ERR", e.stack || e.message); process.exit(1); });

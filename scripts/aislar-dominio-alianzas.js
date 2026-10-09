// Pone Alianzas en un dominio DEDICADO (qi-vantarush.com), sin compartirlo
// con ninguna otra campana.
//
// POR QUE: el 2026-10-08, con Alianzas en 53% de rebote, se encontro que sus
// 2 cuentas vivian en dominios COMPARTIDOS: automation.qivanta@qi-vantarush
// (comparte qi-vantarush.com con Piloto) y partners.qivanta@qi-vantanova.com
// (comparte qi-vantanova.com con Google Maps y Laboratorios). La reputacion
// de envio se mide tambien a nivel de dominio, no solo de buzon individual,
// asi que cada rebote de Alianzas podia estar dañando la entregabilidad de
// las otras 3 campanas sin que ellas hicieran nada mal.
//
// Pedido explicito del usuario: "que alianza ocupe una cuenta dedicada de
// correo para no afectar las demas". Con solo 3 dominios y 8 buzones (2-3
// por dominio) no hay forma de comprar un dominio nuevo al instante, pero SI
// hay margen para reorganizar: qi-vantarush.com solo tiene 2 buzones en
// total (strategy, automation), asi que dandole los 2 a Alianzas, ese
// dominio queda intacto para las otras 3 campanas.
//
// Nuevo mapa (antes / despues):
//   Alianzas:      automation.qivanta@qi-vantarush.com (sin cambio)
//                  partners.qivanta@qi-vantanova.com -> strategy.qivanta@qi-vantarush.com
//   Piloto LATAM:  strategy.qivanta@qi-vantarush.com -> solutions.qivanta@qi-vantanova.com
//   Google Maps:   sin cambio (advisory.qivantaedge + transformation.qivantanova)
//   Laboratorios:  solutions.qivanta@qi-vantanova.com -> partners.qivanta@qi-vantanova.com
//
//   node scripts/aislar-dominio-alianzas.js          # simulacion
//   node scripts/aislar-dominio-alianzas.js --apply  # ejecuta
const fs = require("fs");
const path = require("path");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const APPLY = process.argv.includes("--apply");
const BASE = "https://server.smartlead.ai/api/v1";

// Nuevo mapa deseado (mismo formato que normalizar-dos-cuentas-por-campana.js)
const NUEVO_MAPA = {
  "4093533": { nombre: "Piloto LATAM", cuentas: [24121206, 24113864] },   // transformation.edge + solutions.nova
  "4093546": { nombre: "Alianzas", cuentas: [24121167, 24121168] },        // automation.rush + strategy.rush — dominio EXCLUSIVO
  "4093547": { nombre: "Google Maps", cuentas: [24121141, 24113690] },     // advisory.edge + transformation.nova — sin cambio
  "4093548": { nombre: "Laboratorios", cuentas: [24121137, 24113684] },    // joaquin.edge + partners.nova
};

async function api(metodo, ruta, cuerpo) {
  const sep = ruta.includes("?") ? "&" : "?";
  const r = await fetch(`${BASE}${ruta}${sep}api_key=${encodeURIComponent(process.env.SMARTLEAD_API_KEY)}`, {
    method: metodo, headers: { "Content-Type": "application/json" }, body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json };
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log(`${APPLY ? "EJECUTANDO" : "SIMULACION"} aislamiento de dominio para Alianzas\n`);
  for (const [id, { nombre, cuentas }] of Object.entries(NUEVO_MAPA)) {
    const antes = await api("GET", `/campaigns/${id}/email-accounts`);
    const idsAntes = (Array.isArray(antes.json) ? antes.json : []).map((a) => a.id);
    console.log(`${nombre} (${id}): ${idsAntes.join(",")} -> ${cuentas.join(",")}`);
    if (!APPLY) continue;

    if (idsAntes.length) {
      const d = await api("DELETE", `/campaigns/${id}/email-accounts`, { email_account_ids: idsAntes });
      console.log(`  desasociar ${d.status}`);
      await esperar(1500);
    }
    const p = await api("POST", `/campaigns/${id}/email-accounts`, { email_account_ids: cuentas });
    console.log(`  asociar ${p.status} ${JSON.stringify(p.json).slice(0, 100)}`);
    await esperar(1500);
  }

  if (!APPLY) { console.log("\nCon --apply lo aplica. qi-vantarush.com queda exclusivo de Alianzas."); return; }

  console.log("\n=== verificacion ===");
  const all = await api("GET", "/email-accounts/?offset=0&limit=100");
  for (const [id, { nombre }] of Object.entries(NUEVO_MAPA)) {
    const acc = await api("GET", `/campaigns/${id}/email-accounts`);
    const correos = (Array.isArray(acc.json) ? acc.json : []).map((a) => a.from_email);
    console.log(`  ${nombre.padEnd(14)} ${correos.join(", ")}`);
  }
})().catch((e) => { console.error("ERR", e.stack || e.message); process.exit(1); });

// Lanza busquedas NUEVAS de Apify para la campana Google Maps (4093547),
// sin tocar Smartlead. Los resultados se recogen con
// scripts/recolectar-apify-google-maps.js.
//
// POR QUE aparte de lanzar-apify-solo-mongo.js: ese tiene 6 trabajos FIJOS
// (3 de laboratorios + 3 de Google Maps) que ya se corrieron y recolectaron
// el 2026-10-07 por la manana — de ahi salieron los 15 leads de Google Maps
// y los 32 de laboratorios. Repetirlos solo devolveria duplicados.
//
// Pedido explicito del usuario el 2026-10-07: mas leads de Google Maps desde
// Apify, porque la campana solo tenia 25 leads cargados contra una capacidad
// de 80 correos al dia.
//
// Las consultas/ciudades de abajo son NUEVAS (no estaban en los 6 trabajos
// anteriores) para no volver a pagar por negocios que ya estan en Mongo.
//
//   node scripts/lanzar-apify-google-maps.js          # simulacion
//   node scripts/lanzar-apify-google-maps.js --apply  # lanza (gasta en Apify)
const fs = require("fs");
const path = require("path");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const { iniciarBusqueda } = require("../api/_apify");

const APPLY = process.argv.includes("--apply");
const CAMPAIGN_ID = "4093547";
const MAX_POR_BUSQUEDA = 120;

// Giros con operacion administrativa real (citas, seguimiento, cobranza),
// que es el gancho de la campana. Ciudades distintas a las ya barridas.
const TRABAJOS = [
  ["clinica de especialidades", "Puebla, Puebla"],
  ["centro de imagenologia", "Ciudad de México"],
  ["clinica veterinaria", "Querétaro, Querétaro"],
  ["centro de rehabilitacion fisica", "Monterrey, Nuevo León"],
  ["clinica oftalmologica", "Guadalajara, Jalisco"],
  ["centro odontologico", "Mérida, Yucatán"],
];

(async () => {
  console.log(`${APPLY ? "LANZANDO" : "SIMULACION"} — ${TRABAJOS.length} busquedas, hasta ${MAX_POR_BUSQUEDA} negocios cada una`);
  for (const [query, location] of TRABAJOS) console.log(`  "${query}" en ${location}`);
  if (!APPLY) {
    console.log(`\nCon --apply las lanza (hasta ${TRABAJOS.length * MAX_POR_BUSQUEDA} negocios, gasto en Apify).`);
    return;
  }
  if (!process.env.APIFY_API_TOKEN) throw new Error("Falta APIFY_API_TOKEN en .env.local");

  const startedAt = new Date().toISOString();
  const runs = [];
  for (const [query, location] of TRABAJOS) {
    const run = await iniciarBusqueda({ query, location, maxResultados: MAX_POR_BUSQUEDA });
    runs.push({ campaignKey: "google_maps", campaignId: CAMPAIGN_ID, query, location, ...run, startedAt });
    console.log(`  lanzada "${query}" / ${location} -> run ${run.runId}`);
  }
  const out = path.join(__dirname, "..", ".apify-google-maps-runs.json");
  fs.writeFileSync(out, JSON.stringify({ startedAt, runs }, null, 2));
  console.log(`\n${runs.length} corrida(s) lanzadas. Estado guardado en ${path.basename(out)}`);
  console.log("Siguiente: node scripts/recolectar-apify-google-maps.js");
})().catch((e) => { console.error("ERR", e.stack || e.message); process.exitCode = 1; });

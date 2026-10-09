// Lanza búsquedas pagadas de Apify para captar leads, sin subir nada a Smartlead.
const fs = require("fs");
const path = require("path");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}
const { iniciarBusqueda } = require("../api/_apify");
const jobs = [
  ["laboratorios", "laboratorio clínico", "Ciudad de México"],
  ["laboratorios", "laboratorio de análisis clínicos", "Guadalajara, Jalisco"],
  ["laboratorios", "laboratorio clínico", "Monterrey, Nuevo León"],
  ["google_maps", "clínica médica", "Ciudad de México"],
  ["google_maps", "consultorio médico", "Guadalajara, Jalisco"],
  ["google_maps", "clínica dental", "Monterrey, Nuevo León"],
];
(async () => {
  const startedAt = new Date().toISOString();
  const runs = [];
  for (const [campaignKey, query, location] of jobs) {
    const run = await iniciarBusqueda({ query, location, maxResultados: 250 });
    runs.push({ campaignKey, campaignId: campaignKey === "laboratorios" ? "4093548" : "4093547", query, location, ...run, startedAt });
  }
  const out = path.join(__dirname, "..", ".apify-solo-mongo-runs.json");
  fs.writeFileSync(out, JSON.stringify({ startedAt, runs }, null, 2));
  console.log(JSON.stringify({ started: runs.length, runs }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });

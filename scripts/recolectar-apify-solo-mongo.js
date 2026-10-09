// Espera corridas de Apify y guarda resultados segmentados en Mongo.
// No genera mensajes ni llama a Smartlead.
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const { consultarBusqueda } = require("../api/_apify");
const { esCadenaConocida, esEmpresaNoContactar, esInmobiliaria } = require("../api/_empresaGrande");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}
// --archivo permite recolectar otras tandas de corridas con la misma logica
// (p.ej. .apify-google-maps-runs.json de lanzar-apify-google-maps.js), en vez
// de duplicar este recolector. Sin el argumento se comporta igual que antes.
const idxArchivo = process.argv.indexOf("--archivo");
const nombreArchivo = idxArchivo >= 0 && process.argv[idxArchivo + 1] ? process.argv[idxArchivo + 1] : ".apify-solo-mongo-runs.json";
const runFile = path.join(__dirname, "..", nombreArchivo);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function store(col, run, negocios) {
  const stats = { received: negocios.length, saved: 0, duplicate: 0, blocked: 0 };
  for (const negocio of negocios) {
    if (esCadenaConocida(negocio.nombre) || esEmpresaNoContactar(negocio) || esInmobiliaria({ nombre: negocio.nombre, categoria: negocio.categoria })) { stats.blocked++; continue; }
    const key = negocio.googleMapsUrl ? { googleMapsUrl: negocio.googleMapsUrl } : { telefono: negocio.telefono };
    const existing = await col.findOne(key, { projection: { _id: 1 } });
    if (existing) { stats.duplicate++; continue; }
    await col.insertOne({
      ...negocio,
      origen: "apify_google_maps", origenBusqueda: `${run.query} — ${run.location}`,
      campaignId: run.campaignId, campaignKey: run.campaignKey,
      campaignName: run.campaignKey === "laboratorios" ? "Laboratorios" : "Qi-Vanta | Apify Google Maps",
      estado: "captado_sin_enviar", emailEstado: negocio.correo ? "pendiente_carga_smartlead" : "sin_correo",
      createdAt: new Date(),
    });
    stats.saved++;
  }
  return stats;
}
(async () => {
  const data = JSON.parse(fs.readFileSync(runFile, "utf8"));
  const pending = data.runs.filter((run) => !run.collectedAt);
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  await client.connect();
  try {
    const col = client.db(process.env.MONGODB_DB || "qivanta_chatbot").collection("leads");
    for (let tries = 0; pending.length && tries < 120; tries++) {
      for (let i = pending.length - 1; i >= 0; i--) {
        const run = pending[i];
        const result = await consultarBusqueda(run.runId);
        if (!result.listo) continue;
        run.collectionStats = await store(col, run, result.negocios || []);
        run.collectedAt = new Date().toISOString();
        pending.splice(i, 1);
        fs.writeFileSync(runFile, JSON.stringify(data, null, 2));
        console.log(JSON.stringify({ completed: run.runId, campaignKey: run.campaignKey, stats: run.collectionStats }));
      }
      if (pending.length) await sleep(30000);
    }
    console.log(JSON.stringify({ remaining: pending.map((run) => run.runId) }));
  } finally { await client.close(); }
})().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });

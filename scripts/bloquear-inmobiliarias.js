// Marca inmobiliarias existentes en Mongo y las elimina de todas las colas
// de Smartlead para que nunca reciban correo, mensaje ni llamada.
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const { esInmobiliaria } = require("../api/_empresaGrande");

for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}
const base = "https://server.smartlead.ai/api/v1";
const key = process.env.SMARTLEAD_API_KEY;
const campaignIds = [process.env.SMARTLEAD_CAMPAIGN_ID, process.env.SMARTLEAD_CAMPAIGN_ID_LATAM, process.env.SMARTLEAD_CAMPAIGN_ID_ALIANZAS || "3990563"].filter(Boolean);

async function leadsSmartlead(campaignId) {
  const todos = [];
  for (let offset = 0; ; offset += 100) {
    const r = await fetch(`${base}/campaigns/${campaignId}/leads?api_key=${encodeURIComponent(key)}&offset=${offset}&limit=100`);
    if (!r.ok) throw new Error(`Smartlead ${r.status} al leer campaña ${campaignId}`);
    const d = await r.json();
    const pagina = d.data || [];
    todos.push(...pagina);
    if (pagina.length < 100) return todos;
  }
}

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const col = client.db(process.env.MONGODB_DB || "qivanta_chatbot").collection("leads");
    const docs = await col.find({}).project({ empresa: 1, nombre: 1 }).toArray();
    const ids = docs.filter((d) => esInmobiliaria({ nombre: d.empresa || d.nombre })).map((d) => d._id);
    if (ids.length) await col.updateMany({ _id: { $in: ids } }, { $set: { estado: "bloqueado_inmobiliaria", motivoBloqueo: "bienes_raices", bloqueadoEn: new Date() } });
    let eliminadosSmartlead = 0;
    for (const campaignId of campaignIds) {
      const leads = await leadsSmartlead(campaignId);
      for (const item of leads) {
        const lead = item.lead || {};
        if (!esInmobiliaria({ nombre: lead.company_name || "" })) continue;
        const r = await fetch(`${base}/campaigns/${campaignId}/leads/${lead.id}?api_key=${encodeURIComponent(key)}`, { method: "DELETE" });
        if (r.ok) eliminadosSmartlead++;
      }
    }
    console.log(JSON.stringify({ bloqueadosMongo: ids.length, eliminadosSmartlead }));
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message); process.exitCode = 1; });

// Cruza leads recientes de Mongo con su estado real en Smartlead (solo lectura).
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}
const BASE = "https://server.smartlead.ai/api/v1";
async function getLeads(campaignId) {
  const statuses = new Map();
  for (let offset = 0;; offset += 100) {
    const response = await fetch(`${BASE}/campaigns/${campaignId}/leads?api_key=${encodeURIComponent(process.env.SMARTLEAD_API_KEY)}&offset=${offset}&limit=100`);
    if (!response.ok) throw new Error(`${campaignId}: HTTP ${response.status}`);
    const page = (await response.json()).data || [];
    for (const item of page) statuses.set(String(item.lead?.email || "").toLowerCase(), { status: item.status, unsubscribed: Boolean(item.lead?.is_unsubscribed), category: item.lead_category_id || null });
    if (page.length < 100) return statuses;
  }
}
(async () => {
  const now = new Date(); const since = new Date(now); since.setDate(since.getDate() - 1); since.setHours(0,0,0,0);
  const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
  try {
    const rows = await client.db(process.env.MONGODB_DB || "qivanta_chatbot").collection("leads").find({
      createdAt: { $gte: since, $lte: now }, correo: { $type: "string", $ne: "" }, emailEstado: "enviado_a_campana",
      $or: [{ origen: "apollo_latam" }, { origenBusqueda: { $exists: true, $ne: "" } }],
    }).project({ correo: 1, campaignId: 1, campaignName: 1, campaignKey: 1, origen: 1, origenBusqueda: 1 }).toArray();
    const ids = [...new Set(rows.map((r) => String(r.campaignId)).filter(Boolean))];
    const lookup = new Map(await Promise.all(ids.map(async (id) => [id, await getLeads(id)])));
    const summary = new Map();
    for (const row of rows) {
      const real = lookup.get(String(row.campaignId))?.get(row.correo.toLowerCase());
      const key = JSON.stringify({ campaignId: row.campaignId, campaignName: row.campaignName, source: row.origen === "apollo_latam" ? "apollo" : "apify", status: real?.status || "MISSING", safe: !real?.unsubscribed && !real?.category });
      summary.set(key, (summary.get(key) || 0) + 1);
    }
    console.log(JSON.stringify({ rows: [...summary.entries()].map(([key,count]) => ({ ...JSON.parse(key), count })) }, null, 2));
  } finally { await client.close(); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });

const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}
const BASE = "https://server.smartlead.ai/api/v1";
const campaigns = [["Piloto LATAM", "4093533"], ["Alianzas", "4093546"], ["Google Maps", "4093547"]];
async function get(route) {
  const sep = route.includes("?") ? "&" : "?";
  const r = await fetch(`${BASE}${route}${sep}api_key=${encodeURIComponent(process.env.SMARTLEAD_API_KEY)}`);
  if (!r.ok) throw new Error(`${route}: ${r.status}`);
  return r.json();
}
(async () => {
  const [info, client] = await Promise.all([
    Promise.all(campaigns.map(async ([name, id]) => {
      const [campaign, leads] = await Promise.all([get(`/campaigns/${id}`), get(`/campaigns/${id}/leads?offset=0&limit=100`)]);
      return { name, id, status: campaign.status, cap: campaign.max_leads_per_day, schedule: campaign.scheduler_cron_value, leadsReturned: (leads.data || []).length, statuses: (leads.data || []).reduce((acc, row) => { acc[row.status] = (acc[row.status] || 0) + 1; return acc; }, {}) };
    })),
    (async () => { const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); return c; })(),
  ]);
  try {
    const rows = await client.db(process.env.MONGODB_DB || "qivanta_chatbot").collection("leads").aggregate([
      { $match: { $or: [{ smartleadImportedAt: { $exists: true } }, { emailEstado: "bloqueado_limite_contactos_smartlead" }] } },
      { $group: { _id: { campaignKey: "$campaignKey", emailEstado: "$emailEstado" }, count: { $sum: 1 } } },
    ]).toArray();
    console.log(JSON.stringify({ campaigns: info, mongo: rows }, null, 2));
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message); process.exitCode = 1; });

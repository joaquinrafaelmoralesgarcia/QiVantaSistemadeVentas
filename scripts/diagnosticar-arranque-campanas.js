// Diagnóstico de sólo lectura para cargar leads de Mongo y arrancar Smartlead.
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}
const BASE = "https://server.smartlead.ai/api/v1";
const campaigns = [["piloto_latam", "Piloto LATAM", "4093533"], ["alianzas", "Alianzas", "4093546"], ["google_maps", "Google Maps", "4093547"], ["laboratorios", "Laboratorios", "4093548"]];
async function get(route) { const sep = route.includes("?") ? "&" : "?"; const r = await fetch(`${BASE}${route}${sep}api_key=${encodeURIComponent(process.env.SMARTLEAD_API_KEY)}`); if (!r.ok) throw new Error(`${route}: HTTP ${r.status}`); return r.json(); }
(async () => {
  const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
  try {
    const col = client.db(process.env.MONGODB_DB || "qivanta_chatbot").collection("leads");
    const since = new Date(); since.setDate(since.getDate() - 1); since.setHours(0, 0, 0, 0);
    const mongo = await Promise.all(campaigns.map(async ([key, name]) => {
      const match = { campaignKey: key, createdAt: { $gte: since }, correo: { $type: "string", $ne: "" } };
      const [total, ready, pending, statuses] = await Promise.all([
        col.countDocuments(match),
        col.countDocuments({ ...match, asuntoEmail: { $type: "string", $ne: "" }, cuerpoEmail: { $type: "string", $ne: "" }, seguimiento1Asunto: { $type: "string", $ne: "" }, seguimiento1: { $type: "string", $ne: "" }, seguimiento2Asunto: { $type: "string", $ne: "" }, seguimiento2: { $type: "string", $ne: "" } }),
        col.countDocuments({ ...match, emailEstado: { $in: [null, "pendiente_carga_smartlead", "bloqueado_limite_contactos_smartlead", "error"] } }),
        col.aggregate([{ $match: match }, { $group: { _id: { estado: "$estado", emailEstado: "$emailEstado" }, count: { $sum: 1 } } }]).toArray(),
      ]);
      return { key, name, totalWithEmail: total, readyWithCopy: ready, pending, statuses };
    }));
    const smartlead = await Promise.all(campaigns.map(async ([key, name, id]) => {
      const [campaign, leadList] = await Promise.all([get(`/campaigns/${id}`), get(`/campaigns/${id}/leads?offset=0&limit=100`)]);
      const data = leadList.data || [];
      return { key, name, id, status: campaign.status, accounts: campaign.email_account_ids?.length || 0, schedule: campaign.scheduler_cron_value || null, dailyCap: campaign.max_leads_per_day || null, leadsReturned: data.length, leadStatuses: data.reduce((a, row) => { a[row.status] = (a[row.status] || 0) + 1; return a; }, {}) };
    }));
    console.log(JSON.stringify({ since, mongo, smartlead }, null, 2));
  } finally { await client.close(); }
})().catch((e) => { console.error(e.stack || e.message); process.exitCode = 1; });

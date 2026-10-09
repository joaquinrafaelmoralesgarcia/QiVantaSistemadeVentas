// Retira de Smartlead el backlog histórico INPROGRESS confirmado por el
// usuario, conservando una marca de retiro en Mongo. No toca campañas nuevas.
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}
const BASE = "https://server.smartlead.ai/api/v1";
const CAMPAIGNS = [["Piloto LATAM histórico", "3842244"], ["Google Maps histórico", "3890342"], ["Alianzas histórico", "3990563"]];
async function api(method, route) {
  const sep = route.includes("?") ? "&" : "?";
  const response = await fetch(`${BASE}${route}${sep}api_key=${encodeURIComponent(process.env.SMARTLEAD_API_KEY)}`, { method });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(`${method} ${route}: ${JSON.stringify(data).slice(0, 240)}`);
  return data;
}
async function runPool(items, worker, concurrency = 5) {
  let next = 0; const out = [];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < items.length) {
      const item = items[next++];
      try { out.push({ item, ok: true, value: await worker(item) }); }
      catch (error) { out.push({ item, ok: false, error: error.message }); }
    }
  }));
  return out;
}
(async () => {
  const targets = [];
  for (const [name, campaignId] of CAMPAIGNS) {
    for (let offset = 0;; offset += 100) {
      const page = (await api("GET", `/campaigns/${campaignId}/leads?offset=${offset}&limit=100`)).data || [];
      for (const row of page) if (row.status === "INPROGRESS" && row.lead?.id) targets.push({ name, campaignId, id: row.lead.id, email: String(row.lead.email || "").toLowerCase() });
      if (page.length < 100) break;
    }
  }
  if (targets.length < 1800) throw new Error(`Se esperaban al menos 1800 históricos INPROGRESS; Smartlead devolvió ${targets.length}. No se borró nada.`);
  const result = await runPool(targets, (lead) => api("DELETE", `/campaigns/${lead.campaignId}/leads/${lead.id}`));
  const removed = result.filter((row) => row.ok).map((row) => row.item);
  const failures = result.filter((row) => !row.ok).map((row) => ({ campaign: row.item.name, leadId: row.item.id, error: row.error }));
  const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
  try {
    const col = client.db(process.env.MONGODB_DB || "qivanta_chatbot").collection("leads");
    const now = new Date();
    for (let i = 0; i < removed.length; i += 500) {
      const emails = removed.slice(i, i + 500).map((row) => row.email).filter(Boolean);
      if (emails.length) await col.updateMany({ correo: { $in: emails } }, { $set: { smartleadRemovedAt: now, smartleadRemovedReason: "reinicio_historicos_inprogress" } });
    }
  } finally { await client.close(); }
  const byCampaign = removed.reduce((acc, row) => { acc[row.name] = (acc[row.name] || 0) + 1; return acc; }, {});
  console.log(JSON.stringify({ requested: targets.length, removed: removed.length, byCampaign, failures }, null, 2));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });

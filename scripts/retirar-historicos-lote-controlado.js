// Retira un lote pequeño de INPROGRESS para respetar el límite de Smartlead.
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}
const BASE = "https://server.smartlead.ai/api/v1";
const CAMPAIGNS = [["Piloto LATAM", "3842244"], ["Google Maps", "3890342"], ["Alianzas", "3990563"]];
const LIMIT = 20;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function api(method, route) {
  const sep = route.includes("?") ? "&" : "?";
  const response = await fetch(`${BASE}${route}${sep}api_key=${encodeURIComponent(process.env.SMARTLEAD_API_KEY)}`, { method });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(`${response.status}:${JSON.stringify(data).slice(0, 160)}`);
  return data;
}
(async () => {
  const candidates = [];
  for (const [name, campaignId] of CAMPAIGNS) {
    if (candidates.length >= LIMIT) break;
    const page = (await api("GET", `/campaigns/${campaignId}/leads?offset=0&limit=100`)).data || [];
    for (const row of page) if (row.status === "INPROGRESS" && row.lead?.id) {
      candidates.push({ name, campaignId, id: row.lead.id, email: String(row.lead.email || "").toLowerCase() });
      if (candidates.length >= LIMIT) break;
    }
  }
  const removed = []; const failures = [];
  for (const lead of candidates) {
    try { await api("DELETE", `/campaigns/${lead.campaignId}/leads/${lead.id}`); removed.push(lead); await pause(650); }
    catch (error) { failures.push({ id: lead.id, error: error.message }); break; }
  }
  const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
  try {
    const emails = removed.map((lead) => lead.email).filter(Boolean);
    if (emails.length) await client.db(process.env.MONGODB_DB || "qivanta_chatbot").collection("leads").updateMany({ correo: { $in: emails } }, { $set: { smartleadRemovedAt: new Date(), smartleadRemovedReason: "reinicio_historicos_inprogress" } });
  } finally { await client.close(); }
  console.log(JSON.stringify({ candidates: candidates.length, removed: removed.length, failures }, null, 2));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });

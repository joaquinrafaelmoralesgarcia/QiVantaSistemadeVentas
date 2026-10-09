// Borra hasta 25 contactos terminales por ejecución. Relee la campaña en
// cada lote para que la paginación no salte registros tras una eliminación.
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}
const BASE = "https://server.smartlead.ai/api/v1";
const CAMPAIGNS = [["Piloto LATAM", "3842244"], ["Google Maps", "3890342"], ["Alianzas", "3990563"], ["Laboratorios", "4084702"]];
const LIMIT = 25;
async function request(method, route) {
  const sep = route.includes("?") ? "&" : "?";
  const res = await fetch(`${BASE}${route}${sep}api_key=${encodeURIComponent(process.env.SMARTLEAD_API_KEY)}`, { method });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) throw new Error(`${method} ${route}: ${JSON.stringify(json).slice(0, 240)}`);
  return json;
}
(async () => {
  const candidates = [];
  for (const [name, campaignId] of CAMPAIGNS) {
    if (candidates.length >= LIMIT) break;
    for (let offset = 0; candidates.length < LIMIT; offset += 100) {
      const page = (await request("GET", `/campaigns/${campaignId}/leads?offset=${offset}&limit=100`)).data || [];
      for (const row of page) {
        const lead = row.lead || {};
        if ((["COMPLETED", "BLOCKED"].includes(row.status) || lead.is_unsubscribed) && lead.id) {
          candidates.push({ name, campaignId, id: lead.id, email: String(lead.email || "").toLowerCase(), status: row.status });
          if (candidates.length >= LIMIT) break;
        }
      }
      if (page.length < 100) break;
    }
  }
  const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
  try {
    const col = client.db(process.env.MONGODB_DB || "qivanta_chatbot").collection("leads");
    const removed = []; const failures = [];
    for (const lead of candidates) {
      try {
        await request("DELETE", `/campaigns/${lead.campaignId}/leads/${lead.id}`);
        removed.push(lead);
        if (lead.email) await col.updateMany({ correo: lead.email }, { $set: { smartleadRemovedAt: new Date(), smartleadRemovedReason: `depuración_terminal_${lead.status}` } });
      } catch (error) { failures.push({ leadId: lead.id, error: error.message }); }
    }
    console.log(JSON.stringify({ candidates: candidates.length, removed: removed.length, failures }, null, 2));
  } finally { await client.close(); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });

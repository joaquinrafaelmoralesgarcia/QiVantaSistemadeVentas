// Depura un lote de hasta 25 terminales encontrados con el mismo recorrido
// paginado de la auditoría, mostrando de qué página se obtuvieron.
const fs = require("fs");
const path = require("path");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}
const BASE = "https://server.smartlead.ai/api/v1";
const CAMPAIGNS = [["Google Maps", "3890342"], ["Alianzas", "3990563"]];
async function api(method, route) {
  const sep = route.includes("?") ? "&" : "?";
  const res = await fetch(`${BASE}${route}${sep}api_key=${encodeURIComponent(process.env.SMARTLEAD_API_KEY)}`, { method });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) throw new Error(`${method} ${route}: ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}
(async () => {
  const found = []; const pages = [];
  for (const [name, campaignId] of CAMPAIGNS) {
    for (let offset = 0; offset < 2000 && found.length < 25; offset += 100) {
      const page = (await api("GET", `/campaigns/${campaignId}/leads?offset=${offset}&limit=100`)).data || [];
      const terminal = page.filter((row) => ["COMPLETED", "BLOCKED"].includes(row.status) || row.lead?.is_unsubscribed);
      pages.push({ name, offset, size: page.length, terminal: terminal.length });
      for (const row of terminal) {
        found.push({ campaignId, id: row.lead.id, email: String(row.lead.email || "").toLowerCase(), status: row.status });
        if (found.length >= 25) break;
      }
      if (page.length < 100) break;
    }
  }
  const removed = []; const failures = [];
  for (const lead of found) {
    try { await api("DELETE", `/campaigns/${lead.campaignId}/leads/${lead.id}`); removed.push(lead); }
    catch (error) { failures.push({ id: lead.id, error: error.message }); }
  }
  console.log(JSON.stringify({ pages, found: found.length, removed: removed.length, failures }, null, 2));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });

const fs = require("fs");
const path = require("path");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}
const BASE = "https://server.smartlead.ai/api/v1";
const campaigns = [["Piloto LATAM histórico", "3842244"], ["Google Maps histórico", "3890342"], ["Alianzas histórico", "3990563"]];
async function get(route) { const sep = route.includes("?") ? "&" : "?"; const r = await fetch(`${BASE}${route}${sep}api_key=${encodeURIComponent(process.env.SMARTLEAD_API_KEY)}`); if (!r.ok) throw new Error(`${route}: ${r.status}`); return r.json(); }
(async () => {
  const result = [];
  for (const [name, id] of campaigns) {
    const counts = {}; let total = 0;
    for (let offset = 0;; offset += 100) {
      const page = (await get(`/campaigns/${id}/leads?offset=${offset}&limit=100`)).data || [];
      total += page.length;
      for (const row of page) counts[row.status || "UNKNOWN"] = (counts[row.status || "UNKNOWN"] || 0) + 1;
      if (page.length < 100) break;
    }
    result.push({ name, id, total, counts });
  }
  console.log(JSON.stringify(result, null, 2));
})().catch((e) => { console.error(e.message); process.exitCode = 1; });

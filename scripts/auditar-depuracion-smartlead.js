// Auditoría de solo lectura para liberar almacenamiento de contactos sin
// eliminar seguimientos activos. Considera únicamente campañas históricas.
const fs = require("fs");
const path = require("path");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}
const BASE = "https://server.smartlead.ai/api/v1";
const CAMPAIGNS = [
  ["Piloto LATAM histórico", "3842244"],
  ["Google Maps histórico", "3890342"],
  ["Alianzas histórico", "3990563"],
  ["Laboratorios histórico", "4084702"],
];
async function api(route) {
  const sep = route.includes("?") ? "&" : "?";
  const response = await fetch(`${BASE}${route}${sep}api_key=${encodeURIComponent(process.env.SMARTLEAD_API_KEY)}`);
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
  return response.json();
}
(async () => {
  const result = [];
  for (const [name, campaignId] of CAMPAIGNS) {
    const counts = {}; const removable = [];
    for (let offset = 0;; offset += 100) {
      const page = (await api(`/campaigns/${campaignId}/leads?offset=${offset}&limit=100`)).data || [];
      for (const row of page) {
        const status = row.status || "UNKNOWN";
        counts[status] = (counts[status] || 0) + 1;
        const lead = row.lead || {};
        // Sólo terminales: no se borra INPROGRESS/STARTED ni leads sin
        // categoría terminal. Así se preservan los seguimientos pendientes.
        if (["COMPLETED", "BLOCKED"].includes(status) || lead.is_unsubscribed) {
          removable.push({ id: lead.id, email: lead.email || "", status, unsubscribed: Boolean(lead.is_unsubscribed) });
        }
      }
      if (page.length < 100) break;
    }
    result.push({ name, campaignId, counts, removable: removable.length, sample: removable.slice(0, 3) });
  }
  console.log(JSON.stringify({ campaigns: result, totalRemovable: result.reduce((sum, item) => sum + item.removable, 0) }, null, 2));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });

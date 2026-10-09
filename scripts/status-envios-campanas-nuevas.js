// Consulta de sólo lectura: envíos de hoy de las campañas nuevas.
const fs = require("fs");
const path = require("path");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}
const BASE = "https://server.smartlead.ai/api/v1";
const campaigns = [["Piloto LATAM", "4093533"], ["Alianzas", "4093546"], ["Google Maps", "4093547"], ["Laboratorios", "4093548"]];
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
async function get(route) {
  const sep = route.includes("?") ? "&" : "?";
  const r = await fetch(`${BASE}${route}${sep}api_key=${encodeURIComponent(process.env.SMARTLEAD_API_KEY)}`);
  if (!r.ok) throw new Error(`${route}: HTTP ${r.status}`);
  return r.json();
}
(async () => {
  const rows = await Promise.all(campaigns.map(async ([name, id]) => {
    const [daily, campaign, analytics, accounts] = await Promise.all([get(`/campaigns/${id}/analytics-by-date?start_date=${today}&end_date=${today}`), get(`/campaigns/${id}`), get(`/campaigns/${id}/analytics`), get(`/campaigns/${id}/email-accounts`)]);
    return { name, id, status: campaign.status, sent: Number(daily.sent_count || 0), uniqueSent: Number(daily.unique_sent_count || 0), opened: Number(daily.open_count || 0), replies: Number(daily.reply_count || 0), bounced: Number(daily.bounce_count || 0), loadedLeads: analytics.campaign_lead_stats?.total ?? null, accounts: Array.isArray(accounts) ? accounts.length : accounts?.data?.length ?? null };
  }));
  console.log(JSON.stringify({ date: today, rows, totalSent: rows.reduce((n, row) => n + row.sent, 0), totalUnique: rows.reduce((n, row) => n + row.uniqueSent, 0) }, null, 2));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });

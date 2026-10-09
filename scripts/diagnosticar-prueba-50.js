// Inventario de solo lectura para una prueba de envíos en Smartlead.
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}

const BASE = "https://server.smartlead.ai/api/v1";
const campaigns = [
  ["Google Maps", process.env.SMARTLEAD_CAMPAIGN_ID || "3890342"],
  ["Piloto LATAM", process.env.SMARTLEAD_CAMPAIGN_ID_LATAM || "3842244"],
  ["Alianzas", process.env.SMARTLEAD_CAMPAIGN_ID_ALIANZAS || "3990563"],
  ["Laboratorios", process.env.SMARTLEAD_CAMPAIGN_ID_LABORATORIOS || "4084702"],
];

async function api(route) {
  const sep = route.includes("?") ? "&" : "?";
  const response = await fetch(`${BASE}${route}${sep}api_key=${encodeURIComponent(process.env.SMARTLEAD_API_KEY)}`);
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
  return response.json();
}

(async () => {
  const [accountList, details] = await Promise.all([
    api("/email-accounts/?offset=0&limit=100"),
    Promise.all(campaigns.map(async ([name, id]) => {
      const info = await api(`/campaigns/${id}`);
      const stats = info.campaign_lead_stats || info.stats || {};
      return {
        name, id, status: info.status,
        maxNewLeadsPerDay: info.max_leads_per_day,
        intervalMinutes: info.scheduler_cron_value?.min_time_btw_emails,
        emailAccounts: Array.isArray(info.email_account_ids) ? info.email_account_ids.length : null,
        stats,
      };
    })),
  ]);
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const leads = client.db(process.env.MONGODB_DB || "qivanta_chatbot").collection("leads");
    const mongo = await Promise.all(campaigns.map(async ([name, id]) => ({
      name,
      rows: await leads.countDocuments({ campaignId: String(id) }),
      withEmail: await leads.countDocuments({ campaignId: String(id), correo: { $type: "string", $ne: "" } }),
    })));
    const accounts = (Array.isArray(accountList) ? accountList : []).map((a) => ({
      email: a.from_email,
      healthy: Boolean(a.is_smtp_success),
      dailyLimit: a.message_per_day || 0,
    }));
    console.log(JSON.stringify({ campaigns: details, mongo, accounts }, null, 2));
  } finally { await client.close(); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });

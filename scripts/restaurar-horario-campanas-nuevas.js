const fs = require("fs");
const path = require("path");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}
const BASE = "https://server.smartlead.ai/api/v1";
const campaigns = ["4093533", "4093546", "4093547", "4093548"];
async function api(method, route, body) {
  const separator = route.includes("?") ? "&" : "?";
  const res = await fetch(`${BASE}${route}${separator}api_key=${encodeURIComponent(process.env.SMARTLEAD_API_KEY)}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${route}: HTTP ${res.status}`);
  return res.json().catch(() => ({}));
}
(async () => {
  const out = [];
  for (const id of campaigns) {
    const current = await api("GET", `/campaigns/${id}`);
    await api("POST", `/campaigns/${id}/schedule`, {
      timezone: current.scheduler_cron_value?.tz || "America/Mexico_City",
      days_of_the_week: [1, 2, 3, 4, 5],
      start_hour: "08:00", end_hour: "19:00", min_time_btw_emails: 3,
      max_new_leads_per_day: 80,
    });
    out.push(id);
  }
  console.log(JSON.stringify({ restored: out, window: "08:00-19:00 America/Mexico_City" }));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });

// Asigna dos buzones sanos a cada campaña nueva y las deja activas.
const fs = require("fs"); const path = require("path");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const BASE = "https://server.smartlead.ai/api/v1";
const assignments = [
  { name: "Piloto LATAM", id: "4093533", accounts: [24121206, 24121168] },
  { name: "Alianzas", id: "4093546", accounts: [24113684, 24121167] },
  { name: "Google Maps", id: "4093547", accounts: [24121141, 24113690] },
  { name: "Laboratorios", id: "4093548", accounts: [24121137, 24113864] },
];
async function call(method, route, body) { const sep = route.includes("?") ? "&" : "?"; const r = await fetch(`${BASE}${route}${sep}api_key=${encodeURIComponent(process.env.SMARTLEAD_API_KEY)}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 200) }; } if (!r.ok) throw new Error(`${method} ${route}: HTTP ${r.status} ${JSON.stringify(data)}`); return data; }
(async () => {
  const out = [];
  for (const item of assignments) {
    const assigned = await call("POST", `/campaigns/${item.id}/email-accounts`, { email_account_ids: item.accounts });
    await call("POST", `/campaigns/${item.id}/schedule`, { timezone: "America/Mexico_City", days_of_the_week: [1, 2, 3, 4, 5], start_hour: "08:00", end_hour: "19:00", min_time_btw_emails: 3, max_new_leads_per_day: 80 });
    const started = await call("POST", `/campaigns/${item.id}/status`, { status: "START" });
    out.push({ name: item.name, accounts: item.accounts, assigned, started });
  }
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e.stack || e.message); process.exitCode = 1; });

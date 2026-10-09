const fs = require("fs"); const path = require("path");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const ids = ["4093533", "4093546", "4093547", "4093548"];
(async () => { const out = {}; for (const id of ids) { const r = await fetch(`https://server.smartlead.ai/api/v1/campaigns/${id}/email-accounts?api_key=${encodeURIComponent(process.env.SMARTLEAD_API_KEY)}`); out[id] = { status: r.status, body: await r.json().catch(() => null) }; } console.log(JSON.stringify(out, null, 2)); })().catch((e) => { console.error(e.message); process.exitCode = 1; });

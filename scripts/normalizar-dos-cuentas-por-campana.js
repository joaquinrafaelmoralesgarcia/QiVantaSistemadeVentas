// Conserva exactamente dos buzones por campaña nueva, según la asignación aprobada.
//
// Asignación vigente desde el 2026-10-08 (scripts/aislar-dominio-alianzas.js):
// Alianzas tiene qi-vantarush.com EXCLUSIVO (ningún otro buzón de ese dominio
// sirve a otra campaña), para que su rebote no dañe la reputación de dominio
// de Piloto/Google Maps/Laboratorios, que viven en qi-vantaedge.com y
// qi-vantanova.com.
const fs = require("fs"); const path = require("path");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const desired = { "4093533": [24121206,24113864], "4093546": [24121167,24121168], "4093547": [24121141,24113690], "4093548": [24121137,24113684] };
async function request(method, id, body) { const r = await fetch(`https://server.smartlead.ai/api/v1/campaigns/${id}/email-accounts?api_key=${encodeURIComponent(process.env.SMARTLEAD_API_KEY)}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); const data = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${id} ${method}: ${r.status}`); return data; }
(async () => { const out = {}; for (const [id, keep] of Object.entries(desired)) { const current = await request("GET", id); const remove = (Array.isArray(current) ? current : []).map((a) => a.id).filter((accountId) => !keep.includes(accountId)); if (remove.length) await request("DELETE", id, { email_account_ids: remove }); out[id] = { kept: keep, removed: remove }; } console.log(JSON.stringify(out, null, 2)); })().catch((e) => { console.error(e.stack || e.message); process.exitCode = 1; });

// Carga a campañas nuevas sólo leads de Mongo que ya traen copy completo.
// Excluye DNC/inmobiliarias y evita duplicar emails existentes en Smartlead.
const fs = require("fs"); const path = require("path"); const { MongoClient } = require("mongodb");
const { esEmpresaNoContactar, esInmobiliaria } = require("../api/_empresaGrande");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const BASE = "https://server.smartlead.ai/api/v1";
const targets = { piloto_latam: "4093533", alianzas: "4093546", google_maps: "4093547", laboratorios: "4093548" };
async function api(method, route, body) { const sep = route.includes("?") ? "&" : "?"; const r = await fetch(`${BASE}${route}${sep}api_key=${encodeURIComponent(process.env.SMARTLEAD_API_KEY)}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); const data = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${method} ${route}: HTTP ${r.status} ${JSON.stringify(data)}`); return data; }
async function existingEmails(id) { const set = new Set(); for (let offset = 0;; offset += 100) { const data = await api("GET", `/campaigns/${id}/leads?offset=${offset}&limit=100`); const page = data.data || []; for (const row of page) { const email = row.lead?.email || row.email; if (email) set.add(email.toLowerCase()); } if (page.length < 100) return set; } }
function hasCopy(lead) { return [lead.asuntoEmail, lead.cuerpoEmail, lead.seguimiento1Asunto, lead.seguimiento1, lead.seguimiento2Asunto, lead.seguimiento2].every((x) => typeof x === "string" && x.trim()); }
function custom(lead, key) { const fields = { qi_vanta_subject: lead.asuntoEmail, qi_vanta_message: lead.cuerpoEmail, qi_vanta_followup1_subject: lead.seguimiento1Asunto, qi_vanta_followup1: lead.seguimiento1, qi_vanta_followup2_subject: lead.seguimiento2Asunto, qi_vanta_followup2: lead.seguimiento2 }; return key === "alianzas" ? { ...fields, alianza_subject: lead.asuntoEmail, alianza_message: lead.cuerpoEmail, alianza_followup1_subject: lead.seguimiento1Asunto, alianza_followup1: lead.seguimiento1, alianza_followup2_subject: lead.seguimiento2Asunto, alianza_followup2: lead.seguimiento2 } : fields; }
(async () => { const client = new MongoClient(process.env.MONGODB_URI); await client.connect(); try { const col = client.db(process.env.MONGODB_DB || "qivanta_chatbot").collection("leads"); const since = new Date(); since.setDate(since.getDate() - 1); since.setHours(0,0,0,0); const summary = {};
  for (const [key, campaignId] of Object.entries(targets)) { const present = await existingEmails(campaignId); const leads = await col.find({ campaignKey: key, createdAt: { $gte: since }, correo: { $type: "string", $ne: "" } }).toArray(); let added = 0, duplicate = 0, skipped = 0, failed = 0;
    for (const lead of leads) { const email = lead.correo.toLowerCase(); if (!hasCopy(lead) || esEmpresaNoContactar({ empresa: lead.empresa, nombre: lead.empresa, correo: lead.correo }) || esInmobiliaria({ nombre: lead.empresa, categoria: lead.categoria })) { skipped++; continue; } if (present.has(email)) { duplicate++; continue; }
      const response = await api("POST", `/campaigns/${campaignId}/leads`, { lead_list: [{ first_name: lead.nombre || "", email: lead.correo, company_name: lead.empresa || "", custom_fields: custom(lead, key) }] });
      if (response.ok !== true || Number(response.upload_count) !== 1) { failed++; continue; }
      present.add(email); added++; await col.updateOne({ _id: lead._id }, { $set: { campaignId, emailEstado: "enviado_a_campana", smartleadImportedAt: new Date() } });
    }
    summary[key] = { added, alreadyPresent: duplicate, skipped, failed };
  } console.log(JSON.stringify(summary, null, 2));
} finally { await client.close(); } })().catch((e) => { console.error(e.stack || e.message); process.exitCode = 1; });

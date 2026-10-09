// Reintenta el lote de 100 tras liberar almacenamiento en Smartlead. Cada
// respuesta se valida y Mongo sólo se marca cargado si Smartlead lo acepta.
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const { esEmpresaNoContactar, esInmobiliaria } = require("../api/_empresaGrande");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}
const BASE = "https://server.smartlead.ai/api/v1";
const TARGETS = { piloto_latam: { id: "4093533", count: 78 }, alianzas: { id: "4093546", count: 18 }, google_maps: { id: "4093547", count: 4 } };
async function api(method, route, body) {
  const sep = route.includes("?") ? "&" : "?";
  const response = await fetch(`${BASE}${route}${sep}api_key=${encodeURIComponent(process.env.SMARTLEAD_API_KEY)}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${route}: HTTP ${response.status}`);
  return data;
}
function valid(lead) {
  const fields = [lead.correo, lead.asuntoEmail, lead.cuerpoEmail, lead.seguimiento1Asunto, lead.seguimiento1, lead.seguimiento2Asunto, lead.seguimiento2];
  return fields.every((value) => typeof value === "string" && value.trim()) &&
    !esEmpresaNoContactar({ nombre: lead.empresa, empresa: lead.empresa, sitioWeb: lead.sitioWeb, correo: lead.correo }) &&
    !esInmobiliaria({ nombre: lead.empresa, categoria: lead.categoria });
}
function fields(lead, key) {
  const result = { qi_vanta_subject: lead.asuntoEmail, qi_vanta_message: lead.cuerpoEmail, qi_vanta_followup1_subject: lead.seguimiento1Asunto, qi_vanta_followup1: lead.seguimiento1, qi_vanta_followup2_subject: lead.seguimiento2Asunto, qi_vanta_followup2: lead.seguimiento2 };
  return key === "alianzas" ? { ...result, alianza_subject: lead.asuntoEmail, alianza_message: lead.cuerpoEmail, alianza_followup1_subject: lead.seguimiento1Asunto, alianza_followup1: lead.seguimiento1, alianza_followup2_subject: lead.seguimiento2Asunto, alianza_followup2: lead.seguimiento2 } : result;
}
(async () => {
  const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
  try {
    const col = client.db(process.env.MONGODB_DB || "qivanta_chatbot").collection("leads");
    const batch = await col.find({ emailEstado: "bloqueado_limite_contactos_smartlead", bloqueadoSmartleadAt: { $exists: true } }).sort({ createdAt: 1 }).toArray();
    const grouped = Object.fromEntries(Object.keys(TARGETS).map((key) => [key, batch.filter((lead) => lead.campaignKey === key && valid(lead))]));
    for (const [key, target] of Object.entries(TARGETS)) if (grouped[key].length !== target.count) throw new Error(`${key}: se esperaban ${target.count} leads válidos y hay ${grouped[key].length}.`);
    const result = {};
    for (const [key, list] of Object.entries(grouped)) {
      const target = TARGETS[key]; let added = 0; const rejected = [];
      for (const lead of list) {
        const reply = await api("POST", `/campaigns/${target.id}/leads`, { lead_list: [{ first_name: lead.nombre || "", email: lead.correo, company_name: lead.empresa || "", phone_number: "", custom_fields: fields(lead, key) }] });
        if (reply.ok !== true || Number(reply.upload_count) !== 1) { rejected.push({ id: lead._id, error: reply.error || "respuesta sin confirmación" }); continue; }
        added++;
        await col.updateOne({ _id: lead._id }, { $set: { emailEstado: "enviado_a_campana", smartleadImportedAt: new Date(), campaignId: target.id }, $unset: { bloqueadoSmartleadAt: "", emailError: "" } });
      }
      result[key] = { target: target.id, added, rejected };
      if (rejected.length) throw new Error(`${key}: Smartlead rechazó ${rejected.length} leads; se detiene antes de activar.`);
    }
    console.log(JSON.stringify({ result }, null, 2));
  } finally { await client.close(); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });

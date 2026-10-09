// Auditoría de solo lectura para la lista permanente de no contacto.
const fs = require("fs");
const path = require("path");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}

const { getDb } = require("../api/_mongo");
const { esEmpresaNoContactar } = require("../api/_empresaGrande");

const CAMPAIGN_IDS = [
  process.env.SMARTLEAD_CAMPAIGN_ID,
  process.env.SMARTLEAD_CAMPAIGN_ID_LATAM,
  process.env.SMARTLEAD_CAMPAIGN_ID_ALIANZAS || "3990563",
  "4084702",
].filter(Boolean);

async function smartleadLeads(campaignId) {
  const found = [];
  let offset = 0;
  while (true) {
    const response = await fetch(`https://server.smartlead.ai/api/v1/campaigns/${campaignId}/leads?api_key=${encodeURIComponent(process.env.SMARTLEAD_API_KEY)}&offset=${offset}&limit=100`);
    if (!response.ok) throw new Error(`Smartlead ${response.status} al consultar campaña ${campaignId}`);
    const data = await response.json();
    const page = data.data || [];
    for (const item of page) {
      const lead = item.lead || {};
      const blockedBy = esEmpresaNoContactar({ nombre: lead.company_name, empresa: lead.company_name, correo: lead.email });
      if (blockedBy) found.push({ campaignId, leadId: lead.id, company: lead.company_name || "", email: lead.email || "", blockedBy });
    }
    if (page.length < 100) break;
    offset += page.length;
  }
  return found;
}

async function main() {
  const db = await getDb();
  const mongoLeads = await db.collection("leads").find({}).project({ nombre: 1, empresa: 1, correo: 1, campaignId: 1, campaignName: 1, estado: 1, motivoBloqueo: 1 }).toArray();
  const mongoMatches = mongoLeads
    .map((lead) => ({ ...lead, blockedBy: esEmpresaNoContactar(lead) }))
    .filter((lead) => lead.blockedBy);
  const smartleadMatches = (await Promise.all(CAMPAIGN_IDS.map(smartleadLeads))).flat();
  if (process.argv.includes("--apply")) {
    const now = new Date();
    for (const lead of mongoMatches) {
      await db.collection("leads").updateOne(
        { _id: lead._id },
        { $set: { estado: "bloqueado_no_contactar", motivoBloqueo: lead.blockedBy, bloqueadoEn: now } }
      );
    }
    for (const lead of smartleadMatches) {
      const response = await fetch(`https://server.smartlead.ai/api/v1/campaigns/${lead.campaignId}/leads/${lead.leadId}?api_key=${encodeURIComponent(process.env.SMARTLEAD_API_KEY)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(`Smartlead ${response.status} al retirar lead ${lead.leadId}`);
    }
    console.log(JSON.stringify({ mongoBlocked: mongoMatches.length, smartleadRemoved: smartleadMatches.length }));
    process.exit(0);
  }
  console.log(JSON.stringify({ mongoMatches, smartleadMatches }, null, 2));
  process.exit(0);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });

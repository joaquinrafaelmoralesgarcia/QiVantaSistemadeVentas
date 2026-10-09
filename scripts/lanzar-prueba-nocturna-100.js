// Lanza una única prueba nocturna de 100 leads recientes, repartidos por
// disponibilidad real. Sólo incluye correos que no están en ninguna campaña
// de Smartlead, con contenido completo y sin exclusiones permanentes.
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const { esEmpresaNoContactar, esInmobiliaria } = require("../api/_empresaGrande");

for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}

const APPLY = process.argv.includes("--apply");
const PROBE = process.argv.includes("--probe");
const BASE = "https://server.smartlead.ai/api/v1";
const TARGETS = {
  piloto_latam: { id: "4093533", quota: 78, name: "Piloto LATAM" },
  alianzas: { id: "4093546", quota: 18, name: "Alianzas" },
  google_maps: { id: "4093547", quota: 4, name: "Google Maps" },
};
const ALL_CAMPAIGNS = ["3842244", "3890342", "3990563", "4084702", "4093533", "4093546", "4093547", "4093548"];

async function api(method, route, body) {
  const separator = route.includes("?") ? "&" : "?";
  const response = await fetch(`${BASE}${route}${separator}api_key=${encodeURIComponent(process.env.SMARTLEAD_API_KEY)}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${route}: HTTP ${response.status} ${JSON.stringify(data).slice(0, 400)}`);
  return data;
}

async function emailsEnSmartlead() {
  const seen = new Set();
  for (const campaignId of ALL_CAMPAIGNS) {
    for (let offset = 0;; offset += 100) {
      const data = await api("GET", `/campaigns/${campaignId}/leads?offset=${offset}&limit=100`);
      const page = data.data || [];
      for (const row of page) {
        const email = String(row.lead?.email || "").trim().toLowerCase();
        if (email) seen.add(email);
      }
      if (page.length < 100) break;
    }
  }
  return seen;
}

function complete(lead) {
  return [lead.correo, lead.asuntoEmail, lead.cuerpoEmail, lead.seguimiento1Asunto, lead.seguimiento1, lead.seguimiento2Asunto, lead.seguimiento2]
    .every((value) => typeof value === "string" && value.trim());
}

function safe(lead) {
  return !esEmpresaNoContactar({ nombre: lead.empresa, empresa: lead.empresa, sitioWeb: lead.sitioWeb, correo: lead.correo }) &&
    !esInmobiliaria({ nombre: lead.empresa, categoria: lead.categoria });
}

function customFields(lead, campaignKey) {
  const base = {
    qi_vanta_subject: lead.asuntoEmail,
    qi_vanta_message: lead.cuerpoEmail,
    qi_vanta_followup1_subject: lead.seguimiento1Asunto,
    qi_vanta_followup1: lead.seguimiento1,
    qi_vanta_followup2_subject: lead.seguimiento2Asunto,
    qi_vanta_followup2: lead.seguimiento2,
  };
  if (campaignKey !== "alianzas") return base;
  return { ...base,
    alianza_subject: lead.asuntoEmail, alianza_message: lead.cuerpoEmail,
    alianza_followup1_subject: lead.seguimiento1Asunto, alianza_followup1: lead.seguimiento1,
    alianza_followup2_subject: lead.seguimiento2Asunto, alianza_followup2: lead.seguimiento2,
  };
}

(async () => {
  const now = new Date();
  const since = new Date(now); since.setDate(since.getDate() - 1); since.setHours(0, 0, 0, 0);
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const col = client.db(process.env.MONGODB_DB || "qivanta_chatbot").collection("leads");
    const [rows, occupied] = await Promise.all([
      col.find({
        createdAt: { $gte: since, $lte: now },
        correo: { $type: "string", $ne: "" },
        emailEstado: "enviado_a_campana",
        campaignKey: { $in: Object.keys(TARGETS) },
        $or: [{ origen: "apollo_latam" }, { origenBusqueda: { $exists: true, $ne: "" } }],
      }).sort({ createdAt: 1 }).toArray(),
      emailsEnSmartlead(),
    ]);
    const selected = {};
    const discarded = { existing: 0, blocked: 0, incomplete: 0, duplicate: 0 };
    const chosen = new Set();
    for (const key of Object.keys(TARGETS)) selected[key] = [];
    for (const lead of rows) {
      const target = TARGETS[lead.campaignKey];
      if (!target || selected[lead.campaignKey].length >= target.quota) continue;
      const email = lead.correo.trim().toLowerCase();
      if (occupied.has(email)) { discarded.existing++; continue; }
      if (chosen.has(email)) { discarded.duplicate++; continue; }
      if (!safe(lead)) { discarded.blocked++; continue; }
      if (!complete(lead)) { discarded.incomplete++; continue; }
      chosen.add(email); selected[lead.campaignKey].push(lead);
    }
    const summary = Object.fromEntries(Object.entries(selected).map(([key, list]) => [key, list.length]));
    const total = Object.values(summary).reduce((sum, count) => sum + count, 0);
    if (!APPLY) {
      console.log(JSON.stringify({ mode: "dry-run", since: since.toISOString(), total, summary, discarded }, null, 2));
      return;
    }
    if (total !== 100) throw new Error(`El lote seguro no suma 100 (${total}); no se envió nada.`);
    if (PROBE) {
      const lead = selected.piloto_latam[0];
      const response = await api("POST", `/campaigns/${TARGETS.piloto_latam.id}/leads`, {
        lead_list: [{ first_name: lead.nombre || "", email: lead.correo, company_name: lead.empresa || "", phone_number: "", custom_fields: customFields(lead, "piloto_latam") }],
      });
      console.log(JSON.stringify({ mode: "probe", response }, null, 2));
      return;
    }
    const weekday = now.getDay() === 0 ? 7 : now.getDay();
    const results = {};
    for (const [key, list] of Object.entries(selected)) {
      const target = TARGETS[key];
      for (const lead of list) {
        const response = await api("POST", `/campaigns/${target.id}/leads`, {
          lead_list: [{
            first_name: lead.nombre || "", email: lead.correo, company_name: lead.empresa || "", phone_number: "",
            custom_fields: customFields(lead, key),
          }],
        });
        if (response?.ok === false || response?.status === false) throw new Error(`Smartlead rechazó ${lead.correo}: ${JSON.stringify(response)}`);
      }
      const info = await api("GET", `/campaigns/${target.id}`);
      const schedule = info.scheduler_cron_value || {};
      await api("POST", `/campaigns/${target.id}/schedule`, {
        timezone: schedule.tz || "America/Mexico_City",
        // Esta ventana se limita al día actual para que no se repita fuera
        // de la prueba nocturna; el horario laboral se restaura después.
        days_of_the_week: [weekday],
        start_hour: "08:00",
        end_hour: "23:59",
        min_time_btw_emails: 3,
        max_new_leads_per_day: list.length,
      });
      await api("POST", `/campaigns/${target.id}/status`, { status: "START" });
      await col.updateMany({ _id: { $in: list.map((lead) => lead._id) } }, {
        $set: {
          campaignId: target.id, campaignName: target.name, emailEstado: "enviado_a_campana",
          pruebaNocturna100At: now, pruebaNocturna100: true,
        },
      });
      results[key] = { campaignId: target.id, added: list.length, dailyCap: list.length };
    }
    console.log(JSON.stringify({ mode: "applied", total, results, discarded, todayOnly: true }, null, 2));
  } finally { await client.close(); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });

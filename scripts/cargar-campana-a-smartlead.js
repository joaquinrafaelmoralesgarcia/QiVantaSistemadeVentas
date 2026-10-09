// Carga a UNA campana (--campana) sus leads de Mongo que ya traen copy
// completo generado por DeepInfra.
//
// POR QUE aparte del cargador general: cargar-listos-mongo-a-smartlead.js
// recorre las 4 campanas de golpe. El 2026-10-07 eso no servia, porque los
// leads de Alianzas tenian copy de plantilla pendiente de regenerar con IA y
// no debian subirse todavia. Este carga SOLO laboratorios.
//
// Valida cada respuesta de Smartlead y solo marca el lead como cargado en
// Mongo si Smartlead confirmo upload_count = 1.
//
//   node scripts/cargar-laboratorios-a-smartlead.js          # simulacion
//   node scripts/cargar-laboratorios-a-smartlead.js --apply  # ejecuta
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const { esEmpresaNoContactar, esInmobiliaria } = require("../api/_empresaGrande");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const APPLY = process.argv.includes("--apply");
const CAMPANAS = { laboratorios: "4093548", google_maps: "4093547", piloto_latam: "4093533", alianzas: "4093546" };
const iC = process.argv.indexOf("--campana");
const CAMPANA = iC >= 0 && process.argv[iC + 1] ? process.argv[iC + 1] : "laboratorios";
const CAMPAIGN_ID = CAMPANAS[CAMPANA];
if (!CAMPAIGN_ID) { console.error("Campana desconocida: " + CAMPANA + ". Opciones: " + Object.keys(CAMPANAS).join(", ")); process.exit(1); }
const BASE = "https://server.smartlead.ai/api/v1";

async function api(metodo, ruta, cuerpo) {
  const sep = ruta.includes("?") ? "&" : "?";
  const r = await fetch(`${BASE}${ruta}${sep}api_key=${encodeURIComponent(process.env.SMARTLEAD_API_KEY)}`, {
    method: metodo, headers: { "Content-Type": "application/json" }, body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${metodo} ${ruta}: HTTP ${r.status} ${JSON.stringify(data).slice(0, 160)}`);
  return data;
}

const CAMPOS = ["asuntoEmail", "cuerpoEmail", "seguimiento1Asunto", "seguimiento1", "seguimiento2Asunto", "seguimiento2"];
const tieneCopy = (l) => CAMPOS.every((c) => typeof l[c] === "string" && l[c].trim());

async function correosYaEnCampana() {
  const set = new Set();
  for (let offset = 0; ; offset += 100) {
    const data = await api("GET", `/campaigns/${CAMPAIGN_ID}/leads?offset=${offset}&limit=100`);
    const page = data.data || [];
    for (const row of page) {
      const correo = row.lead?.email || row.email;
      if (correo) set.add(correo.toLowerCase());
    }
    if (page.length < 100) return set;
  }
}

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const col = client.db(process.env.MONGODB_DB || "qivanta_chatbot").collection("leads");
    const presentes = await correosYaEnCampana();
    const leads = await col.find({
      campaignKey: CAMPANA,
      emailEstado: { $in: [null, "pendiente_carga_smartlead", "bloqueado_limite_contactos_smartlead", "error"] },
      correo: { $type: "string", $ne: "" },
    }).sort({ createdAt: 1 }).toArray();

    const listos = [];
    let sinCopy = 0, bloqueados = 0, duplicados = 0;
    for (const l of leads) {
      if (!tieneCopy(l)) { sinCopy++; continue; }
      if (esEmpresaNoContactar({ nombre: l.nombre, empresa: l.empresa || l.nombre, sitioWeb: l.sitioWeb, correo: l.correo })
        || esInmobiliaria({ nombre: l.nombre, categoria: l.categoria })) { bloqueados++; continue; }
      if (presentes.has(l.correo.toLowerCase())) { duplicados++; continue; }
      listos.push(l);
    }

    console.log(`${APPLY ? "EJECUTANDO" : "SIMULACION"} — ${CAMPANA} (${CAMPAIGN_ID})`);
    console.log(`  en Mongo pendientes: ${leads.length} | listos para cargar: ${listos.length} | sin copy: ${sinCopy} | bloqueados: ${bloqueados} | ya en campana: ${duplicados}`);
    if (!APPLY || !listos.length) { if (!APPLY) console.log("\nCon --apply los sube a Smartlead."); return; }

    let cargados = 0, fallidos = 0;
    for (const l of listos) {
      const campos = {
        qi_vanta_subject: l.asuntoEmail, qi_vanta_message: l.cuerpoEmail,
        qi_vanta_followup1_subject: l.seguimiento1Asunto, qi_vanta_followup1: l.seguimiento1,
        qi_vanta_followup2_subject: l.seguimiento2Asunto, qi_vanta_followup2: l.seguimiento2,
      };
      // La secuencia de Alianzas usa merge tags propios (alianza_*); se mandan
      // los dos juegos para no depender de cual tenga configurada.
      if (CAMPANA === "alianzas") Object.assign(campos, {
        alianza_subject: l.asuntoEmail, alianza_message: l.cuerpoEmail,
        alianza_followup1_subject: l.seguimiento1Asunto, alianza_followup1: l.seguimiento1,
        alianza_followup2_subject: l.seguimiento2Asunto, alianza_followup2: l.seguimiento2,
      });
      try {
        const r = await api("POST", `/campaigns/${CAMPAIGN_ID}/leads`, {
          lead_list: [{ first_name: l.nombre || "", email: l.correo, company_name: l.empresa || l.nombre || "", custom_fields: campos }],
        });
        if (r.ok !== true || Number(r.upload_count) !== 1) { fallidos++; console.error(`  RECHAZADO ${l.correo}: ${JSON.stringify(r).slice(0, 140)}`); continue; }
        await col.updateOne({ _id: l._id }, { $set: { campaignId: CAMPAIGN_ID, emailEstado: "enviado_a_campana", smartleadImportedAt: new Date() } });
        cargados++;
      } catch (e) { fallidos++; console.error(`  ERROR ${l.correo}: ${e.message}`); }
    }
    console.log(`\n=== cargados: ${cargados} | fallidos: ${fallidos} ===`);
    const an = await api("GET", `/campaigns/${CAMPAIGN_ID}/analytics`);
    console.log(`campana: ${an.status} | leads: ${JSON.stringify(an.campaign_lead_stats)}`);
  } finally {
    await client.close();
  }
})().catch((e) => { console.error("ERR", e.stack || e.message); process.exit(1); });

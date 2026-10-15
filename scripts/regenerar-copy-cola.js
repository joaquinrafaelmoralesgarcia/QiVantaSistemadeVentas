// Regenera con el copy corto (correo 1 sin enlaces, ver _leadScript.js) los
// leads que YA estan cargados en Smartlead pero TODAVIA no han recibido el
// correo 1 (estado STARTED = en cola). A los que ya lo recibieron no se les
// puede cambiar nada.
//
// POR QUE (2026-10-14): Smartlead senalo que el correo 1 salia con enlaces y
// firma pesada, y que eso contribuyo a los bloqueos de Microsoft. Los leads
// cargados antes del 2026-10-12 tienen el copy viejo (3-4 enlaces, ~350
// palabras). Solo se regeneran los que lo tienen: si el cuerpo ya no trae
// enlaces, se omite (ahorra llamadas a DeepInfra).
//
// Campanas: Piloto LATAM y Google Maps (activas) y Laboratorios. Alianzas
// tiene otra plantilla y esta pausada: no se toca.
//
//   node scripts/regenerar-copy-cola.js            # simulacion: cuenta
//   node scripts/regenerar-copy-cola.js --apply    # regenera y actualiza
//   node scripts/regenerar-copy-cola.js --apply --max 5   # prueba con 5
const fs = require("fs");
const path = require("path");
const dns = require("dns");
try { dns.setServers(["8.8.8.8", "1.1.1.1"]); } catch {}
const { MongoClient } = require("mongodb");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const { generarScript, generarScriptEmpresa } = require("../api/_leadScript");

const APPLY = process.argv.includes("--apply");
const iMax = process.argv.indexOf("--max");
const MAX = iMax > -1 ? parseInt(process.argv[iMax + 1], 10) : Infinity;
const BASE = "https://server.smartlead.ai/api/v1";
const KEY = process.env.SMARTLEAD_API_KEY;
const CAMPANAS = [
  { key: "piloto_latam", id: "4093533", nombre: "Piloto LATAM" },
  { key: "google_maps", id: "4093547", nombre: "Google Maps" },
  { key: "laboratorios", id: "4093548", nombre: "Laboratorios" },
];
const CAMPOS_COPY = ["asuntoEmail", "cuerpoEmail", "seguimiento1Asunto", "seguimiento1", "seguimiento2Asunto", "seguimiento2"];
const CONCURRENCIA = 4;

async function api(metodo, ruta, cuerpo) {
  const sep = ruta.includes("?") ? "&" : "?";
  const r = await fetch(`${BASE}${ruta}${sep}api_key=${encodeURIComponent(KEY)}`, {
    method: metodo, headers: { "Content-Type": "application/json" }, body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json };
}

const tieneEnlaces = (t) => /https?:\/\/|<a\s/i.test(t || "");

function generar(lead) {
  if (lead.campaignKey === "piloto_latam") {
    return generarScriptEmpresa({
      nombre: lead.nombre, titulo: lead.titulo, empresa: lead.empresa,
      numEmpleados: typeof lead.numEmpleados === "number" ? lead.numEmpleados : null,
      descripcionEmpresa: lead.descripcionEmpresa || "", sitioWeb: lead.sitioWeb, correo: lead.correo,
    });
  }
  return generarScript({
    nombre: lead.nombre, categoria: lead.categoria, direccion: lead.direccion,
    calificacionGoogle: lead.calificacionGoogle, numResenas: lead.numResenas,
    tieneSitioWeb: lead.tieneSitioWeb, sitioWeb: lead.sitioWeb, probablementeGrande: lead.probablementeGrande,
  });
}

const campos = (s) => ({
  qi_vanta_subject: s.asuntoEmail, qi_vanta_message: s.cuerpoEmail,
  qi_vanta_followup1_subject: s.seguimiento1Asunto, qi_vanta_followup1: s.seguimiento1,
  qi_vanta_followup2_subject: s.seguimiento2Asunto, qi_vanta_followup2: s.seguimiento2,
});

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const col = client.db(process.env.MONGODB_DB || "qivanta_chatbot").collection("leads");
  const total = { enCola: 0, yaNuevos: 0, sinMongo: 0, regenerados: 0, fallidos: 0 };
  let presupuesto = MAX;
  try {
    for (const c of CAMPANAS) {
      const cola = [];
      for (let o = 0; ; o += 100) {
        const r = await api("GET", `/campaigns/${c.id}/leads?offset=${o}&limit=100`);
        const page = r.json?.data || [];
        for (const x of page) if (x.status === "STARTED") cola.push(x);
        if (page.length < 100) break;
      }
      const trabajo = [];
      for (const x of cola) {
        total.enCola++;
        const correo = String(x.lead?.email || "").toLowerCase();
        const doc = await col.findOne({ correo: new RegExp(`^${correo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"), campaignKey: c.key });
        if (!doc) { total.sinMongo++; continue; }
        const cf = x.lead?.custom_fields || {};
        if (!tieneEnlaces(cf.qi_vanta_message || doc.cuerpoEmail)) { total.yaNuevos++; continue; }
        trabajo.push({ x, doc });
      }
      console.log(`${c.nombre}: ${cola.length} en cola, ${trabajo.length} con copy viejo por regenerar`);
      if (!APPLY) continue;

      let i = 0;
      const seleccion = trabajo.slice(0, Math.max(0, presupuesto));
      presupuesto -= seleccion.length;
      await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, seleccion.length) }, async () => {
        while (i < seleccion.length) {
          const { x, doc } = seleccion[i++];
          try {
            const s = await generar(doc);
            if (!CAMPOS_COPY.every((k) => typeof s?.[k] === "string" && s[k].trim())) throw new Error("copy incompleto");
            if (tieneEnlaces(s.cuerpoEmail)) throw new Error("el correo 1 nuevo aun trae enlaces");
            const u = await api("POST", `/campaigns/${c.id}/leads/${x.lead.id}`, {
              email: x.lead.email, first_name: x.lead.first_name || "", company_name: x.lead.company_name || "",
              custom_fields: { ...(x.lead.custom_fields || {}), ...campos(s) },
            });
            if (!u.ok) throw new Error(`Smartlead ${u.status} ${JSON.stringify(u.json).slice(0, 80)}`);
            await col.updateOne({ _id: doc._id }, { $set: {
              asuntoEmail: s.asuntoEmail, cuerpoEmail: s.cuerpoEmail,
              seguimiento1Asunto: s.seguimiento1Asunto, seguimiento1: s.seguimiento1,
              seguimiento2Asunto: s.seguimiento2Asunto, seguimiento2: s.seguimiento2,
              copyGeneradoEn: new Date(), copyGeneradoPor: "deepinfra/regenerar-copy-cola",
            } });
            total.regenerados++;
          } catch (e) {
            total.fallidos++;
            console.error(`  fallo ${x.lead?.email}: ${e.message}`);
          }
        }
      }));
    }
  } finally { await client.close(); }
  console.log(`=== ${APPLY ? "EJECUTADO" : "SIMULACION"} === ${JSON.stringify(total)}`);
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });

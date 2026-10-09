// Reemplaza, en los leads de Alianzas que AUN NO se han enviado (status
// STARTED en Smartlead), el correo personal adivinado por Apollo por un
// correo generico (info@/contacto@) extraido del sitio de la empresa.
//
// POR QUE: el 2026-10-08, Alianzas llego a 68% de rebote. El correo
// genérico lo revisa alguien activamente (lo publica la propia empresa
// como canal de contacto) — mucho mas confiable que un patron adivinado
// nombre.apellido@dominio sin garantia de que exista.
//
// Alcance: SOLO los leads en status STARTED (no se les ha mandado nada
// todavia). Los que ya estan INPROGRESS o COMPLETED (ya tuvieron un primer
// intento, entregado o rebotado) se dejan intactos — no se reenvia ni se
// duplica.
//
// Usa el archivo de resultados ya calculado por extraer-masivo (ver
// scratch/swaps-alianzas.json via TMPDIR) para no volver a crawlear los
// sitios.
//
//   node intercambiar-correo-alianzas.js          # simulacion
//   node intercambiar-correo-alianzas.js --apply  # ejecuta
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
for (const line of fs.readFileSync("G:/chatbotwati/.env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const APPLY = process.argv.includes("--apply");
const CAMPAIGN_ID = "4093546";
const BASE = "https://server.smartlead.ai/api/v1";

async function api(metodo, ruta, cuerpo) {
  const sep = ruta.includes("?") ? "&" : "?";
  const r = await fetch(`${BASE}${ruta}${sep}api_key=${encodeURIComponent(process.env.SMARTLEAD_API_KEY)}`, {
    method: metodo, headers: { "Content-Type": "application/json" }, body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json };
}

(async () => {
  const crudos = JSON.parse(fs.readFileSync(path.join(process.env.TMPDIR, "swaps-alianzas.json"), "utf8"));

  // Sin cambio real (el sitio publica el mismo correo personal como
  // contacto) — nada que hacer, no vale la pena el delete+add.
  const sinCambio = crudos.filter((s) => s.correoNuevo === s.correoViejo);

  // Varios leads de la MISMA empresa cayendo en el MISMO correo generico
  // (ej. 3 contactos de "Inceptio" -> contacto@inceptio.com.mx): crear 3
  // leads identicos en la misma campana es redundante y puede confundir a
  // Smartlead. Se queda solo el primero; a los demas se les retira el
  // correo viejo de la campana pero NO se vuelven a agregar.
  const vistos = new Set();
  const swaps = [];
  const duplicados = [];
  for (const s of crudos) {
    if (s.correoNuevo === s.correoViejo) continue;
    if (vistos.has(s.correoNuevo)) { duplicados.push(s); continue; }
    vistos.add(s.correoNuevo);
    swaps.push(s);
  }

  console.log(`${APPLY ? "EJECUTANDO" : "SIMULACION"} intercambio de correo — ${swaps.length} leads (${sinCambio.length} sin cambio real, ${duplicados.length} duplicados de correo generico)`);

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const col = client.db(process.env.MONGODB_DB || "qivanta_chatbot").collection("leads");
  let ok = 0, fallidos = 0;
  try {
    for (const s of swaps) {
      console.log(`${s.empresa}: ${s.correoViejo} -> ${s.correoNuevo}`);
      if (!APPLY) continue;

      // docId venia de un ObjectId serializado a JSON (se guarda como
      // string hex plano al pasar por JSON.stringify/parse, perdiendo el
      // tipo) — se busca por el correo original, que sigue siendo texto
      // plano identico en Mongo hasta que este mismo bloque lo cambie.
      const doc = await col.findOne({ correo: s.correoViejo });
      if (!doc) { console.error("  SALTADO: ya no existe en Mongo"); fallidos++; continue; }

      const campos = {
        qi_vanta_subject: doc.asuntoEmail, qi_vanta_message: doc.cuerpoEmail,
        qi_vanta_followup1_subject: doc.seguimiento1Asunto, qi_vanta_followup1: doc.seguimiento1,
        qi_vanta_followup2_subject: doc.seguimiento2Asunto, qi_vanta_followup2: doc.seguimiento2,
        alianza_subject: doc.asuntoEmail, alianza_message: doc.cuerpoEmail,
        alianza_followup1_subject: doc.seguimiento1Asunto, alianza_followup1: doc.seguimiento1,
        alianza_followup2_subject: doc.seguimiento2Asunto, alianza_followup2: doc.seguimiento2,
      };

      const del = await api("DELETE", `/campaigns/${CAMPAIGN_ID}/leads/${s.leadId}`);
      const add = await api("POST", `/campaigns/${CAMPAIGN_ID}/leads`, {
        lead_list: [{ first_name: "", email: s.correoNuevo, company_name: doc.empresa || "", custom_fields: campos }],
      });
      if (add.json?.ok !== true || Number(add.json?.upload_count) !== 1) {
        console.error(`  FALLO al re-agregar: del=${del.status} add=${add.status} ${JSON.stringify(add.json).slice(0, 140)}`);
        fallidos++;
        continue;
      }
      await col.updateOne({ _id: doc._id }, { $set: {
        correoPersonalApollo: doc.correo, correo: s.correoNuevo, correoFuente: "sitio_generico", correoActualizadoEn: new Date(),
      } });
      ok++;
    }
    for (const s of duplicados) {
      console.log(`DUPLICADO (solo se retira, no se vuelve a agregar): ${s.empresa} ${s.correoViejo} (ya cubierto por ${s.correoNuevo})`);
      if (!APPLY) continue;
      await api("DELETE", `/campaigns/${CAMPAIGN_ID}/leads/${s.leadId}`);
      await col.updateOne({ correo: s.correoViejo }, { $set: { estado: "duplicado_correo_generico_alianzas", emailEstado: "no_contactar", correoDescartadoDuplicadoDe: s.correoNuevo } });
    }
    console.log(`\n=== intercambiados: ${ok} | fallidos: ${fallidos} | duplicados retirados: ${duplicados.length} ===`);
  } finally {
    await client.close();
  }
})().catch((e) => { console.error("ERR", e.stack || e.message); process.exit(1); });

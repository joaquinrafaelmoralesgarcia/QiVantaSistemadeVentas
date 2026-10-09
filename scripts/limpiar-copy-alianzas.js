// Borra el copy de PLANTILLA FIJA de los leads de Alianzas que aun no se han
// cargado a Smartlead, para que generar-copy-backlog.js lo regenere con
// generarCorreoAlianzaIA (DeepInfra + analisis del sitio por empresa).
//
// POR QUE: hasta el 2026-10-07 Alianzas usaba generarCorreoAlianza(), una
// plantilla identica para todos (decision del usuario del 2026-09-22). Ese
// mismo dia el usuario pidio que TODO el copy saliera de DeepInfra segun el
// analisis de cada empresa, asi que el copy de plantilla ya escrito en el
// backlog hay que descartarlo y volver a generarlo.
//
// SOLO toca leads pendientes de carga: nunca un lead ya enviado a Smartlead,
// para no dejar a un lead con copy distinto del que ya recibio.
//
//   node scripts/limpiar-copy-alianzas.js          # simulacion
//   node scripts/limpiar-copy-alianzas.js --apply  # ejecuta
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const APPLY = process.argv.includes("--apply");
const CAMPOS = ["asuntoEmail", "cuerpoEmail", "seguimiento1Asunto", "seguimiento1", "seguimiento2Asunto", "seguimiento2", "copyGeneradoEn", "copyGeneradoPor"];

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const col = client.db(process.env.MONGODB_DB || "qivanta_chatbot").collection("leads");
    const filtro = {
      campaignKey: "alianzas",
      emailEstado: { $in: [null, "pendiente_carga_smartlead", "bloqueado_limite_contactos_smartlead", "error"] },
      cuerpoEmail: { $type: "string", $ne: "" },
    };
    const n = await col.countDocuments(filtro);
    console.log(`${APPLY ? "EJECUTANDO" : "SIMULACION"} — leads de Alianzas pendientes con copy a borrar: ${n}`);
    if (!APPLY) { console.log("Con --apply borra esos 6 campos de copy para que se regeneren con IA."); return; }
    const r = await col.updateMany(filtro, { $unset: Object.fromEntries(CAMPOS.map((c) => [c, ""])) });
    console.log(`copy borrado en ${r.modifiedCount} lead(s). Ahora: node scripts/generar-copy-backlog.js --campana alianzas`);
  } finally {
    await client.close();
  }
})().catch((e) => { console.error("ERR", e.stack || e.message); process.exit(1); });

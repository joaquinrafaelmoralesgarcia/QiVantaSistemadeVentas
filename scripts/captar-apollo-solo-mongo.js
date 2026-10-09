// Captación masiva de Apollo para llenar Mongo, sin crear ni enviar campañas.
// Revela únicamente correo (nunca teléfono) y respeta el saldo disponible.
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const { buscarPersonas, buscarPersonasAlianzas, revelarCorreo, obtenerCreditosLead } = require("../api/_apollo");
const { esEmpresaNoContactar, esInmobiliaria } = require("../api/_empresaGrande");

for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}
process.env.APOLLO_API_KEY = fs.readFileSync("G:\\Apis\\apiapollo.txt", "utf8").trim();

const PAGE_SIZE = 100;
const MAX_EMPTY_PAGES = 8;
const PAISES = ["mexico"];
const RANGOS = ["1,10", "11,20", "21,50", "51,100", "101,200", "201,500", "501,1000"];
const TITULOS_PILOTO = [
  ["CEO", "Chief Executive Officer", "Director General", "Presidente", "President", "Founder", "Co-Founder", "Fundador"],
  ["Partner", "Socio", "Managing Partner", "Vice President", "VP", "Vicepresidente"],
  ["CIO", "Chief Information Officer", "CTO", "Chief Technology Officer", "Director de TI", "Director de IT", "IT Director"],
  ["Director Comercial", "Commercial Director", "Business Development", "Desarrollo de Negocios"],
  ["Director de Operaciones", "Operations Director"],
];
const STATE_FILE = path.join(__dirname, "..", ".apollo-solo-mongo-state.json");

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return { alianzas: { page: 1, segment: 0 }, piloto_latam: { page: 1, segment: 0 } }; }
}
function saveState(state) { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }
function campaign(key) {
  return key === "alianzas"
    ? { campaignId: "4093546", campaignKey: key, campaignName: "Alianzas" }
    : { campaignId: "4093533", campaignKey: key, campaignName: "Qi-Vanta | Piloto LATAM | Decisores" };
}
function safeCompany(person) { return person.organization?.name || ""; }

async function saveBlocked(col, person, key, reason) {
  await col.updateOne({ apolloId: person.id }, { $setOnInsert: {
    apolloId: person.id, origen: "apollo_latam", ...campaign(key), empresa: safeCompany(person),
    estado: reason, emailEstado: "no_contactar", createdAt: new Date(),
  } }, { upsert: true });
}

// Valores de confianza que NO se aceptan para enviar — pedido explícito del
// usuario el 2026-10-08 tras el 68% de rebote de Alianzas (correos
// adivinados por Apollo). Lista corta a propósito: no se conoce todavía el
// enum real de Apollo (0 créditos desde el 2026-10-07, no se ha visto un
// reveal real). Cuando vuelvan los créditos, revisar emailStatusVistos en
// la salida de este script y ampliar esta lista con lo que Apollo use de
// verdad para "adivinado"/"no verificado" — hoy es una red de seguridad
// mínima, no la solución completa.
const ESTADOS_BAJA_CONFIANZA = ["guessed", "unavailable", "extrapolated", "unverified"];

async function captureOne(col, person, key, contadorEstados) {
  const company = safeCompany(person);
  if (esEmpresaNoContactar({ empresa: company, nombre: company })) { await saveBlocked(col, person, key, "bloqueado_no_contactar"); return "blocked"; }
  if (esInmobiliaria({ nombre: company, empresa: company })) { await saveBlocked(col, person, key, "bloqueado_inmobiliaria"); return "blocked"; }
  if (await col.findOne({ apolloId: person.id }, { projection: { _id: 1 } })) return "duplicate";
  const revealed = await revelarCorreo(person.id);
  if (!revealed?.correo) {
    await col.insertOne({ apolloId: person.id, origen: "apollo_latam", ...campaign(key), empresa: company, estado: "sin_correo_apollo", emailEstado: "sin_correo", createdAt: new Date() });
    return "no_email";
  }
  if (contadorEstados) contadorEstados[String(revealed.emailStatus)] = (contadorEstados[String(revealed.emailStatus)] || 0) + 1;
  if (revealed.emailStatus && ESTADOS_BAJA_CONFIANZA.includes(String(revealed.emailStatus).toLowerCase())) {
    // Se gasta el crédito igual (Apollo ya reveló el correo), pero no se usa
    // para enviar: queda registrado para poder medir cuánto filtra esto.
    await col.insertOne({
      apolloId: person.id, nombre: revealed.nombre, empresa: revealed.empresa, correo: revealed.correo,
      origen: "apollo_latam", ...campaign(key), estado: "correo_baja_confianza_apollo", emailEstado: "no_contactar",
      apolloEmailStatus: revealed.emailStatus, createdAt: new Date(),
    });
    return "baja_confianza";
  }
  // Por instrucción explícita: Apollo sólo conserva nombre, empresa y correo.
  // No se persiste teléfono, título, sitio ni otros datos del perfil.
  await col.insertOne({
    apolloId: person.id,
    nombre: revealed.nombre,
    empresa: revealed.empresa,
    correo: revealed.correo,
    apolloEmailStatus: revealed.emailStatus,
    origen: "apollo_latam", ...campaign(key),
    estado: "captado_sin_enviar", emailEstado: "pendiente_carga_smartlead",
    createdAt: new Date(),
  });
  return "captured";
}

async function nextPeople(key, state) {
  if (key === "alianzas") return buscarPersonasAlianzas({ page: state.page, perPage: PAGE_SIZE, paises: PAISES, rangosEmpleados: RANGOS, segmento: state.segment });
  return buscarPersonas({ page: state.page, perPage: PAGE_SIZE, paises: PAISES, rangosEmpleados: RANGOS, titulos: TITULOS_PILOTO[state.segment % TITULOS_PILOTO.length] });
}

(async () => {
  const credits = await obtenerCreditosLead();
  const requested = Number(process.argv.find((arg) => arg.startsWith("--max="))?.split("=")[1] || credits.left_over || 0);
  const target = Math.max(0, Math.min(requested, Number(credits.left_over || 0)));
  if (!target) { console.log(JSON.stringify({ started: false, credits, reason: "Sin créditos disponibles" })); return; }
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  await client.connect();
  const col = client.db(process.env.MONGODB_DB || "qivanta_chatbot").collection("leads");
  const state = readState();
  const result = { started: true, creditsBefore: credits, target, captured: 0, bajaConfianza: 0, revealedAttempts: 0, duplicate: 0, blocked: 0, noEmail: 0, errors: 0 };
  const emailStatusVistos = {};
  try {
    let empty = 0; let turn = 0;
    while (result.revealedAttempts < target && empty < MAX_EMPTY_PAGES) {
      const key = turn++ % 2 === 0 ? "alianzas" : "piloto_latam";
      const page = await nextPeople(key, state[key]);
      const people = page.personas || [];
      if (!people.length) { empty++; state[key].segment = (state[key].segment + 1) % (key === "alianzas" ? 5 : TITULOS_PILOTO.length); if (state[key].segment === 0) state[key].page++; saveState(state); continue; }
      empty = 0;
      for (const person of people) {
        if (result.revealedAttempts >= target) break;
        try {
          const outcome = await captureOne(col, person, key, emailStatusVistos);
          if (outcome === "captured") { result.captured++; result.revealedAttempts++; }
          else if (outcome === "baja_confianza") { result.bajaConfianza++; result.revealedAttempts++; }
          else if (outcome === "no_email") { result.noEmail++; result.revealedAttempts++; }
          else if (outcome === "duplicate") result.duplicate++;
          else result.blocked++;
        } catch (error) {
          if (error.apolloCode === "BILLING.LIMIT.CREDITS_EXHAUSTED") { result.exhausted = true; break; }
          result.errors++; console.error(JSON.stringify({ type: "lead_error", apolloId: person.id, error: error.message }));
        }
      }
      state[key].segment = (state[key].segment + 1) % (key === "alianzas" ? 5 : TITULOS_PILOTO.length);
      if (state[key].segment === 0) state[key].page++;
      saveState(state);
      if (result.exhausted) break;
      console.log(JSON.stringify({ progress: result, state }));
    }
    result.creditsAfter = await obtenerCreditosLead().catch(() => null);
    // Distribucion REAL de confianza que Apollo devolvio al revelar — revisar
    // esto en la primera corrida con creditos para confirmar el nombre de
    // campo correcto (ver comentario en api/_apollo.js revelarCorreo) y
    // ajustar ESTADOS_BAJA_CONFIANZA si hace falta.
    console.log(JSON.stringify({ complete: result, emailStatusVistos, state }, null, 2));
  } finally { await client.close(); }
})().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });

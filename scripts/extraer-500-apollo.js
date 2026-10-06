// Extracción única autorizada: 250 partners tecnológicos para Alianzas y
// 250 decisores para Piloto LATAM. Guarda todo en Mongo, deduplica antes
// de revelar y JAMÁS solicita teléfonos a Apollo.
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const { buscarPersonas, buscarPersonasAlianzas } = require("../api/_apollo");
const { procesarPersonasApollo } = require("../api/_leadsProcessorEmpresa");

for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}
// La llave del archivo indicado por el usuario tiene precedencia sobre una
// llave vieja que pudiera seguir en .env.local. Nunca se imprime.
process.env.APOLLO_API_KEY = fs.readFileSync("G:\\Apis\\apiapollo.txt", "utf8").trim();

const META = 250;
const PER_PAGE = 25;
const PAISES = ["mexico", "colombia", "argentina", "chile", "peru", "brazil", "ecuador", "uruguay", "paraguay", "bolivia", "costa rica", "panama", "guatemala", "honduras", "el salvador", "dominican republic", "venezuela"];
const RANGOS = ["1,10", "11,20", "21,50", "51,100", "101,200", "201,500", "501,1000"];
const archivoEstado = path.join(__dirname, "..", ".apollo-batch-500-state.json");

function leerEstado() {
  try { return JSON.parse(fs.readFileSync(archivoEstado, "utf8")); }
  catch { return { alianzas: { pagina: 1, segmento: 0, logrados: 0 }, piloto_latam: { pagina: 1, logrados: 0 } }; }
}
function guardarEstado(estado) { fs.writeFileSync(archivoEstado, JSON.stringify(estado, null, 2)); }

async function extraerCampana(db, clave, estado) {
  const esAlianzas = clave === "alianzas";
  const campana = esAlianzas
    ? { campaignId: process.env.SMARTLEAD_CAMPAIGN_ID_ALIANZAS || "3990563", campaignKey: "alianzas", campaignName: "Alianzas" }
    : { campaignId: process.env.SMARTLEAD_CAMPAIGN_ID_LATAM, campaignKey: "piloto_latam", campaignName: "Qi-Vanta | Piloto LATAM | Decisores" };
  let vacias = 0;
  while (estado.logrados < META && vacias < 30) {
    const resultado = esAlianzas
      ? await buscarPersonasAlianzas({ page: estado.pagina, perPage: PER_PAGE, paises: PAISES, rangosEmpleados: RANGOS, segmento: estado.segmento })
      : await buscarPersonas({ page: estado.pagina, perPage: PER_PAGE, paises: PAISES, rangosEmpleados: RANGOS });
    if (!resultado.personas.length) {
      vacias++;
      if (esAlianzas) {
        estado.segmento = (estado.segmento + 1) % 5;
        if (estado.segmento === 0) estado.pagina++;
      } else estado.pagina++;
      guardarEstado(global.estadoBatch);
      continue;
    }
    const stats = await procesarPersonasApollo(db.collection("leads"), resultado.personas, campana);
    const nuevos = stats.intentados || 0;
    // "enviado" y los estados de correo inválido también cuentan como lead
    // capturado/auditado en Mongo; los duplicados no.
    estado.logrados += nuevos;
    estado.pagina++;
    if (stats.detenidoPorErrores) throw new Error(`${clave}: Apollo detuvo la extracción por créditos o error.`);
    guardarEstado(global.estadoBatch);
    console.log(JSON.stringify({ campana: clave, pagina: estado.pagina - 1, logrados: estado.logrados, meta: META, stats }));
  }
  return estado;
}

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  try {
    global.estadoBatch = leerEstado();
    await extraerCampana(client.db(process.env.MONGODB_DB || "qivanta_chatbot"), "alianzas", global.estadoBatch.alianzas);
    await extraerCampana(client.db(process.env.MONGODB_DB || "qivanta_chatbot"), "piloto_latam", global.estadoBatch.piloto_latam);
    console.log(JSON.stringify({ terminado: true, estado: global.estadoBatch }));
  } finally {
    await client.close();
  }
})().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });

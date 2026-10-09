// Genera con DeepInfra el copy que le falta al backlog de leads en Mongo.
//
// POR QUE: el 2026-10-07, al revisar por que no salian correos, se encontro
// que los 2199 leads en emailEstado "pendiente_carga_smartlead" NO tienen
// copy (0 con asunto, 0 con cuerpo). Los capto la via "solo mongo"
// (captar-apollo-solo-mongo.js / recolectar-apify-solo-mongo.js), que guarda
// el contacto pero NO pasa por la generacion de copy de _leadsProcessor.
// Sin los 6 campos de copy, cargar-listos-mongo-a-smartlead.js los salta
// todos, asi que nunca llegan a una campana.
//
// Reutiliza los MISMOS generadores que usa el pipeline en vivo, para que el
// copy del backlog salga identico al que ya se envia:
//   - piloto_latam -> generarScriptEmpresa (incluye analisis del sitio web)
//   - alianzas     -> generarCorreoAlianzaIA (gancho por empresa + analisis del sitio)
//   - google_maps  -> generarScript (catalogo Google Maps / PYME)
//   - laboratorios -> generarScript (son negocios de Apify, sin empresa/titulo)
//
// Es REANUDABLE: solo toma leads sin copy, asi que se puede cortar y volver
// a correr sin duplicar trabajo ni gastar tokens dos veces.
//
//   node scripts/generar-copy-backlog.js --dry                  # que haria
//   node scripts/generar-copy-backlog.js --limit 5              # prueba corta
//   node scripts/generar-copy-backlog.js --campana laboratorios
//   node scripts/generar-copy-backlog.js                        # todo el backlog
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const { generarScript, generarScriptEmpresa } = require("../api/_leadScript");
const { generarCorreoAlianzaIA } = require("../api/_alianzasScript");
const { esEmpresaNoContactar, esInmobiliaria } = require("../api/_empresaGrande");

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const valorDe = (bandera, pordefecto) => {
  const i = args.indexOf(bandera);
  return i >= 0 && args[i + 1] ? args[i + 1] : pordefecto;
};
const LIMITE = Number(valorDe("--limit", "0")) || 0;
const CAMPANA = valorDe("--campana", null);
const CONCURRENCIA = Number(valorDe("--concurrencia", "4")) || 4;

const CAMPOS_COPY = ["asuntoEmail", "cuerpoEmail", "seguimiento1Asunto", "seguimiento1", "seguimiento2Asunto", "seguimiento2"];

// Que generador usa cada campana. Son los mismos del pipeline en vivo; no se
// cambian aqui porque cada uno trae decisiones ya tomadas con el usuario
// (que ofertas, que lineas fijas, que tema de asunto).
function generadorPara(lead) {
  if (lead.campaignKey === "alianzas") return () => generarCorreoAlianzaIA(lead);
  if (lead.campaignKey === "piloto_latam") {
    return () => generarScriptEmpresa({
      nombre: lead.nombre,
      titulo: lead.titulo,
      empresa: lead.empresa,
      numEmpleados: typeof lead.numEmpleados === "number" ? lead.numEmpleados : null,
      descripcionEmpresa: lead.descripcionEmpresa || "",
      sitioWeb: lead.sitioWeb,
    });
  }
  // google_maps y laboratorios: leads de Apify, el nombre ES el negocio.
  return () => generarScript({
    nombre: lead.nombre,
    categoria: lead.categoria,
    direccion: lead.direccion,
    calificacionGoogle: lead.calificacionGoogle,
    numResenas: lead.numResenas,
    tieneSitioWeb: lead.tieneSitioWeb,
    sitioWeb: lead.sitioWeb,
    probablementeGrande: lead.probablementeGrande,
  });
}

function copyCompleto(script) {
  return CAMPOS_COPY.every((c) => typeof script?.[c] === "string" && script[c].trim());
}

(async () => {
  if (!process.env.DEEPINFRA_API_KEY) throw new Error("Falta DEEPINFRA_API_KEY en .env.local");
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const col = client.db(process.env.MONGODB_DB || "qivanta_chatbot").collection("leads");
    const filtro = {
      emailEstado: { $in: [null, "pendiente_carga_smartlead", "bloqueado_limite_contactos_smartlead", "error"] },
      correo: { $type: "string", $ne: "" },
      $or: [{ cuerpoEmail: { $exists: false } }, { cuerpoEmail: "" }, { asuntoEmail: { $exists: false } }, { asuntoEmail: "" }],
    };
    if (CAMPANA) filtro.campaignKey = CAMPANA;

    let leads = await col.find(filtro).sort({ createdAt: 1 }).toArray();
    // Mismas exclusiones que el cargador: no gastar tokens en leads que
    // despues se van a descartar por DNC o bienes raices.
    const descartados = [];
    leads = leads.filter((l) => {
      const motivo = esEmpresaNoContactar({ nombre: l.empresa || l.nombre, empresa: l.empresa || l.nombre, sitioWeb: l.sitioWeb, correo: l.correo })
        || (esInmobiliaria({ nombre: l.empresa || l.nombre, categoria: l.categoria }) ? "bienes_raices" : null);
      if (motivo) descartados.push({ _id: l._id, motivo });
      return !motivo;
    });
    if (LIMITE) leads = leads.slice(0, LIMITE);

    const porCampana = leads.reduce((a, l) => { a[l.campaignKey] = (a[l.campaignKey] || 0) + 1; return a; }, {});
    console.log(`${DRY ? "SIMULACION" : "GENERANDO"} copy con DeepInfra — ${leads.length} lead(s)${LIMITE ? ` (limite ${LIMITE})` : ""}`);
    console.log(`por campana: ${JSON.stringify(porCampana)}`);
    if (descartados.length) console.log(`descartados por DNC/inmobiliaria (no se les genera copy): ${descartados.length}`);
    if (DRY || !leads.length) { console.log(DRY ? "\nSin --dry generaria el copy de esos leads." : "Nada que generar."); return; }

    let ok = 0, fallidos = 0;
    const inicio = Date.now();
    let siguiente = 0;
    async function trabajador(n) {
      while (siguiente < leads.length) {
        const lead = leads[siguiente++];
        const etiqueta = `${lead.campaignKey}/${(lead.empresa || lead.nombre || "").slice(0, 32)}`;
        try {
          const script = await generadorPara(lead)();
          if (!copyCompleto(script)) throw new Error(`copy incompleto: faltan ${CAMPOS_COPY.filter((c) => !script?.[c]?.trim()).join(",")}`);
          await col.updateOne({ _id: lead._id }, { $set: {
            calificacion: script.calificacion ?? null,
            razonamiento: script.razonamiento || "",
            oferta: script.oferta || "",
            asuntoEmail: script.asuntoEmail,
            cuerpoEmail: script.cuerpoEmail,
            seguimiento1Asunto: script.seguimiento1Asunto,
            seguimiento1: script.seguimiento1,
            seguimiento2Asunto: script.seguimiento2Asunto,
            seguimiento2: script.seguimiento2,
            copyGeneradoEn: new Date(),
            copyGeneradoPor: "deepinfra/generar-copy-backlog",
          } });
          ok++;
        } catch (e) {
          fallidos++;
          console.error(`  FALLO ${etiqueta}: ${e.message}`);
        }
        const hechos = ok + fallidos;
        if (hechos % 25 === 0 || hechos === leads.length) {
          const min = (Date.now() - inicio) / 60000;
          console.log(`  ${hechos}/${leads.length} (ok ${ok}, fallidos ${fallidos}) — ${min.toFixed(1)} min, ${(hechos / Math.max(min, 0.01)).toFixed(0)}/min`);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, leads.length) }, (_, i) => trabajador(i)));
    console.log(`\n=== copy generado: ${ok} | fallidos: ${fallidos} | ${((Date.now() - inicio) / 60000).toFixed(1)} min ===`);
    if (fallidos) console.log("Los fallidos siguen sin copy: volver a correr el script los reintenta.");
  } finally {
    await client.close();
  }
})().catch((e) => { console.error("ERR", e.stack || e.message); process.exit(1); });

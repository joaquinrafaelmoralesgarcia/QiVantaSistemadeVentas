// Cron de carga continua de leads: mantiene a cada campaña con un
// colchón de leads listos para enviar, sin que nadie tenga que correr
// cargar-campana-a-smartlead.js o generar-copy-backlog.js a mano.
//
// POR QUE: el 2026-10-08 se encontró que NINGÚN cron cargaba leads nuevos
// — sólo existía cron-monitor-campanas.js (salud) y cron-rampa-envios.js
// (sube el tope de envío), pero nada movía leads de Mongo a Smartlead. El
// tope de envío sube solo cada día, pero sin este cron las campañas se
// quedan sin leads mucho antes de llegar a esa capacidad (Google Maps se
// quedó con 13 leads sin empezar, Piloto con 166, el mismo día que se
// escribió esto).
//
// QUE HACE, por cada campaña activa o pausada (cargar no es lo mismo que
// enviar: una campaña pausada solo deja los leads en cola, listos para
// cuando se reactive):
//   1. Lee cuántos leads "sin empezar" tiene ya en Smartlead.
//   2. Si está por debajo del colchón objetivo, toma leads pendientes de
//      Mongo para esa campaña (respetando los mismos filtros de siempre:
//      sin DNC, sin inmobiliarias, con correo, sin duplicar lo que ya
//      está en la campaña).
//   3. Genera el copy con el generador CORRECTO según el perfil de la
//      campaña (no es el mismo para las 4):
//        piloto_latam  -> generarScriptEmpresa (DeepInfra + análisis de sitio)
//        alianzas      -> generarCorreoAlianzaIA (DeepInfra + análisis de
//                          sitio, núcleo de la alianza fijo, variado por lead)
//        google_maps / laboratorios -> generarScript (catálogo PYME o
//                          enterprise según probablementeGrande)
//   4. Valida que el dominio del correo tenga MX antes de cargarlo.
//   5. Lo sube a Smartlead y marca el lead como enviado_a_campana en Mongo.
//
// Topes de seguridad (controlan costo de DeepInfra y tiempo de corrida):
//   - COLCHON_OBJETIVO: cuántos leads sin empezar se intenta mantener.
//   - MAX_POR_CAMPANA_POR_CORRIDA: tope de altas por campaña en una sola
//     corrida, aunque el déficit sea mayor (se completa en la siguiente
//     corrida, 2 horas después).
//   - MAX_TOTAL_POR_CORRIDA: tope global de altas en una sola corrida.
//
// Vive en la nube (GitHub Actions, ver
// .github/workflows/cron-cargar-leads.yml) — no depende de que esta
// computadora esté prendida.
//
//   node scripts/cron-cargar-leads.js          # ejecuta
//   node scripts/cron-cargar-leads.js --dry    # solo muestra que haria
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

const { generarScript, generarScriptEmpresa } = require("../api/_leadScript");
const { generarCorreoAlianzaIA } = require("../api/_alianzasScript");
const { esEmpresaNoContactar, esInmobiliaria } = require("../api/_empresaGrande");
const { correoTieneServidorValido } = require("../api/_emailVerify");
const { agregarLeadACampania } = require("../api/_smartlead");
const { extraerCorreoGenerico } = require("../api/_correoGenericoSitio");

// Campañas cuyos leads salen de Google Maps (Apify). Apify casi nunca trae
// correo: el 2026-10-08 había 111 negocios con sitio web pero sin correo
// esperando (92 de Google Maps, 19 de Laboratorios) mientras ambas campañas
// se quedaban sin leads. Para un negocio local el correo genérico de su
// propio sitio (info@, contacto@) es justo el canal correcto, así que se
// busca ahí antes de dar la campaña por vacía. Cada sitio se intenta una
// sola vez (correoGenericoIntentadoEn) para no recrawlear en cada corrida.
const CAMPANAS_CON_ENRIQUECIMIENTO = ["google_maps", "laboratorios"];
const MAX_SITIOS_POR_CORRIDA = 40; // cada sitio tarda 1-10s; acota la duración de la corrida

const DRY = process.argv.includes("--dry");
const BASE = "https://server.smartlead.ai/api/v1";

const COLCHON_OBJETIVO = 60;
const MAX_POR_CAMPANA_POR_CORRIDA = 60;
const MAX_TOTAL_POR_CORRIDA = 150;
const CONCURRENCIA = 5;

// Verificación con MillionVerifier ANTES de generar copy y de cargar a
// Smartlead (2026-10-12): Google Maps iba en 13% de rebote y Laboratorios en
// 30%, sobre todo por correos genéricos/gratuitos sacados de sitios web. Va
// antes del copy para no gastar DeepInfra en correos que no se van a usar.
//   ok                  -> se carga
//   invalid/disposable  -> no_contactar (no existe o es desechable)
//   catch_all/unknown   -> verificacion_riesgosa (no se carga, no se reintenta)
// Si la API falla o no hay créditos devuelve null y el lead sigue solo con la
// validación de MX de siempre: un problema del verificador nunca frena la
// carga. Una tasa de rebote real alta la sigue frenando cron-guardian-rebote.
async function verificarCorreo(correo) {
  const key = process.env.MILLIONVERIFIER_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`https://api.millionverifier.com/api/v3/?api=${encodeURIComponent(key)}&email=${encodeURIComponent(correo)}&timeout=20`);
    const data = await res.json();
    if (!res.ok || data.error || !data.result) return null;
    return data.result;
  } catch {
    return null;
  }
}

const CAMPOS_COPY = ["asuntoEmail", "cuerpoEmail", "seguimiento1Asunto", "seguimiento1", "seguimiento2Asunto", "seguimiento2"];

const CAMPANAS = {
  piloto_latam: { campaignId: "4093533", nombre: "Piloto LATAM" },
  alianzas: { campaignId: "4093546", nombre: "Alianzas" },
  google_maps: { campaignId: "4093547", nombre: "Google Maps" },
  laboratorios: { campaignId: "4093548", nombre: "Laboratorios" },
};

async function smartleadGet(ruta) {
  const sep = ruta.includes("?") ? "&" : "?";
  const r = await fetch(`${BASE}${ruta}${sep}api_key=${encodeURIComponent(process.env.SMARTLEAD_API_KEY)}`);
  return r.json().catch(() => null);
}

async function notStartedDeCampania(campaignId) {
  const a = await smartleadGet(`/campaigns/${campaignId}/analytics`);
  return Number(a?.campaign_lead_stats?.notStarted || 0);
}

// Correos ya presentes en la campaña, para no duplicar un lead que ya se
// cargó (aunque Mongo diga pendiente por alguna inconsistencia previa).
async function correosEnCampania(campaignId) {
  const set = new Set();
  for (let offset = 0; ; offset += 100) {
    const d = await smartleadGet(`/campaigns/${campaignId}/leads?offset=${offset}&limit=100`);
    const page = d?.data || [];
    for (const row of page) {
      const correo = row.lead?.email || row.email;
      if (correo) set.add(correo.toLowerCase());
    }
    if (page.length < 100) return set;
  }
}

function tieneCopyCompleto(lead) {
  // Un correo 1 con enlaces es copy VIEJO (anterior al 2026-10-12): Smartlead
  // senalo que los enlaces + firma pesada contribuyeron a los bloqueos de
  // Microsoft. Aunque el lead ya traiga copy guardado en Mongo, se considera
  // incompleto y se regenera con el generador actual (correo 1 sin enlaces).
  if (/https?:\/\/|<a\s/i.test(lead.cuerpoEmail || "")) return false;
  return CAMPOS_COPY.every((c) => typeof lead[c] === "string" && lead[c].trim());
}

// Mismo generador correcto por campaña que usa generar-copy-backlog.js —
// ver ese archivo para el porqué de cada elección (venta consultiva vs.
// propuesta de alianza, catálogo PYME vs. enterprise).
function generadorPara(lead) {
  if (lead.campaignKey === "alianzas") return () => generarCorreoAlianzaIA(lead);
  if (lead.campaignKey === "piloto_latam") {
    return () => generarScriptEmpresa({
      nombre: lead.nombre, titulo: lead.titulo, empresa: lead.empresa,
      numEmpleados: typeof lead.numEmpleados === "number" ? lead.numEmpleados : null,
      descripcionEmpresa: lead.descripcionEmpresa || "", sitioWeb: lead.sitioWeb, correo: lead.correo,
    });
  }
  return () => generarScript({
    nombre: lead.nombre, categoria: lead.categoria, direccion: lead.direccion,
    calificacionGoogle: lead.calificacionGoogle, numResenas: lead.numResenas,
    tieneSitioWeb: lead.tieneSitioWeb, sitioWeb: lead.sitioWeb, probablementeGrande: lead.probablementeGrande,
  });
}

function camposPersonalizados(lead, key) {
  const base = {
    qi_vanta_subject: lead.asuntoEmail, qi_vanta_message: lead.cuerpoEmail,
    qi_vanta_followup1_subject: lead.seguimiento1Asunto, qi_vanta_followup1: lead.seguimiento1,
    qi_vanta_followup2_subject: lead.seguimiento2Asunto, qi_vanta_followup2: lead.seguimiento2,
  };
  if (key !== "alianzas") return base;
  return {
    ...base,
    alianza_subject: lead.asuntoEmail, alianza_message: lead.cuerpoEmail,
    alianza_followup1_subject: lead.seguimiento1Asunto, alianza_followup1: lead.seguimiento1,
    alianza_followup2_subject: lead.seguimiento2Asunto, alianza_followup2: lead.seguimiento2,
  };
}

// Busca correo genérico en el sitio de negocios sin correo de esta campaña.
// Devuelve cuántos quedaron con correo (y por lo tanto en la cola normal).
async function enriquecerSinCorreo(col, key) {
  const sinCorreo = await col.find({
    campaignKey: key,
    $or: [{ correo: { $exists: false } }, { correo: null }, { correo: "" }],
    sitioWeb: { $type: "string", $ne: "" },
    emailEstado: { $nin: ["no_contactar", "enviado_a_campana"] },
    correoGenericoIntentadoEn: { $exists: false },
  }).sort({ createdAt: -1 }).limit(MAX_SITIOS_POR_CORRIDA).toArray();

  let encontrados = 0, i = 0;
  async function trabajador() {
    while (i < sinCorreo.length) {
      const lead = sinCorreo[i++];
      const r = await extraerCorreoGenerico(lead.sitioWeb).catch(() => null);
      const cambios = { correoGenericoIntentadoEn: new Date() };
      // No reutilizar un correo que ya tiene otro lead (misma empresa
      // captada dos veces, o ya contactada por otra campaña).
      const yaUsado = r && await col.findOne({ correo: r.correo, _id: { $ne: lead._id } }, { projection: { _id: 1 } });
      if (r && !yaUsado) {
        Object.assign(cambios, { correo: r.correo, correoFuente: "sitio_generico", emailEstado: "pendiente_carga_smartlead" });
        encontrados++;
      }
      if (!DRY) await col.updateOne({ _id: lead._id }, { $set: cambios });
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, sinCorreo.length) }, trabajador));
  return { revisados: sinCorreo.length, encontrados };
}

async function procesarCampania(col, key, presupuestoRestante) {
  const { campaignId, nombre } = CAMPANAS[key];
  const notStarted = await notStartedDeCampania(campaignId);
  const deficit = Math.max(0, COLCHON_OBJETIVO - notStarted);
  const objetivo = Math.min(deficit, MAX_POR_CAMPANA_POR_CORRIDA, presupuestoRestante);

  const resumen = { campana: nombre, sinEmpezarAntes: notStarted, objetivo, agregados: 0, copyGenerado: 0, copyFallido: 0, correoInvalido: 0, bloqueados: 0, duplicados: 0 };
  if (objetivo <= 0) { resumen.motivo = notStarted >= COLCHON_OBJETIVO ? "colchon ya cubierto" : "sin presupuesto en esta corrida"; return resumen; }

  if (CAMPANAS_CON_ENRIQUECIMIENTO.includes(key)) {
    resumen.sitiosRevisados = 0;
    const e = await enriquecerSinCorreo(col, key);
    resumen.sitiosRevisados = e.revisados;
    resumen.correosDeSitio = e.encontrados;
  }

  const candidatos = await col.find({
    campaignKey: key,
    emailEstado: { $in: [null, "pendiente_carga_smartlead", "bloqueado_limite_contactos_smartlead", "error"] },
    correo: { $type: "string", $ne: "" },
  }).sort({ createdAt: 1 }).limit(objetivo * 4).toArray(); // margen por los que se descartan en el camino

  if (!candidatos.length) { resumen.motivo = "sin leads pendientes en Mongo"; return resumen; }

  const presentes = DRY ? new Set() : await correosEnCampania(campaignId);
  // Correos que YA recibieron campaña antes, en cualquier campaña (actual o
  // vieja). correosEnCampania solo mira la campaña de hoy: encontrado el
  // 2026-10-09, 9 leads pendientes de Piloto ya habían sido contactados en
  // las campañas de septiembre, y ~8 se volvieron a cargar en Alianzas,
  // Google Maps y Laboratorios. Volver a escribirle a alguien que ya se
  // contactó sin decirlo es justo lo que nunca debe pasar.
  const yaContactados = new Set((await col.distinct("correo", { emailEstado: "enviado_a_campana" })).filter(Boolean).map((c) => c.toLowerCase()));
  let i = 0;
  // enVuelo cuenta intentos YA RECLAMADOS pero sin resolver todavia. Sin
  // esto, con CONCURRENCIA=5 y un objetivo chico (ej. 1-2, lo normal en
  // estado estable), los 5 trabajadores leen "agregados < objetivo" ANTES
  // de que el primero termine su trabajo async y lo incremente — los 5
  // reclaman un candidato cada uno y se sobrepasa el objetivo varias veces
  // (encontrado en vivo probando este script: objetivo 1, agregados 4).
  // El chequeo+reclamo de abajo es sincrono (sin await de por medio), asi
  // que no hay carrera real entre trabajadores — Node solo intercala en
  // los puntos de await.
  let enVuelo = 0;
  async function trabajador() {
    while (i < candidatos.length) {
      if (resumen.agregados + enVuelo >= objetivo) break;
      const lead = candidatos[i++];
      enVuelo++;
      try {
        await procesarUno(lead);
      } finally {
        enVuelo--;
      }
    }
  }
  async function procesarUno(lead) {
      const correo = lead.correo.toLowerCase();
      const empresaONombre = lead.empresa || lead.nombre;

      const motivoBloqueo = esEmpresaNoContactar({ nombre: empresaONombre, empresa: empresaONombre, sitioWeb: lead.sitioWeb, correo: lead.correo })
        || (esInmobiliaria({ nombre: empresaONombre, categoria: lead.categoria }) ? "bienes_raices" : null);
      if (motivoBloqueo) {
        resumen.bloqueados++;
        if (!DRY) await col.updateOne({ _id: lead._id }, { $set: { estado: "bloqueado_no_contactar", motivoBloqueo, emailEstado: "no_contactar" } });
        return;
      }
      if (presentes.has(correo)) { resumen.duplicados++; if (!DRY) await col.updateOne({ _id: lead._id }, { $set: { emailEstado: "enviado_a_campana" } }); return; }
      if (yaContactados.has(correo)) {
        resumen.duplicados++;
        if (!DRY) await col.updateOne({ _id: lead._id }, { $set: { estado: "duplicado_ya_contactado", emailEstado: "no_contactar" } });
        return;
      }

      const verificacion = DRY ? null : await verificarCorreo(lead.correo);
      if (verificacion && verificacion !== "ok") {
        resumen.correoInvalido++;
        const riesgoso = verificacion === "catch_all" || verificacion === "unknown";
        await col.updateOne({ _id: lead._id }, { $set: {
          estado: riesgoso ? "verificacion_riesgosa" : "correo_invalido",
          emailEstado: riesgoso ? "verificacion_riesgosa" : "no_contactar",
          verificacion, verificadoEn: new Date(),
        } });
        return;
      }
      if (verificacion === "ok" && !DRY) await col.updateOne({ _id: lead._id }, { $set: { verificacion, verificadoEn: new Date() } });

      let leadConCopy = lead;
      if (!tieneCopyCompleto(lead)) {
        try {
          const script = await generadorPara(lead)();
          if (!CAMPOS_COPY.every((c) => typeof script?.[c] === "string" && script[c].trim())) throw new Error("copy incompleto");
          leadConCopy = { ...lead, ...script };
          resumen.copyGenerado++;
          if (!DRY) await col.updateOne({ _id: lead._id }, { $set: {
            calificacion: script.calificacion ?? null, razonamiento: script.razonamiento || "", oferta: script.oferta || "",
            asuntoEmail: script.asuntoEmail, cuerpoEmail: script.cuerpoEmail,
            seguimiento1Asunto: script.seguimiento1Asunto, seguimiento1: script.seguimiento1,
            seguimiento2Asunto: script.seguimiento2Asunto, seguimiento2: script.seguimiento2,
            copyGeneradoEn: new Date(), copyGeneradoPor: "deepinfra/cron-cargar-leads",
          } });
        } catch (e) {
          resumen.copyFallido++;
          console.error(`  [${nombre}] copy fallido para ${empresaONombre}: ${e.message}`);
          return;
        }
      }

      const correoValido = await correoTieneServidorValido(lead.correo);
      if (!correoValido) {
        resumen.correoInvalido++;
        if (!DRY) await col.updateOne({ _id: lead._id }, { $set: { estado: "correo_invalido", emailEstado: "no_contactar" } });
        return;
      }

      if (DRY) { resumen.agregados++; return; }

      try {
        await agregarLeadACampania({
          nombre: lead.nombre || "", correo: lead.correo, empresa: lead.empresa || lead.nombre || "",
          telefono: "", campaignId, customFields: camposPersonalizados(leadConCopy, key),
        });
        presentes.add(correo);
        await col.updateOne({ _id: lead._id }, { $set: { campaignId, emailEstado: "enviado_a_campana", smartleadImportedAt: new Date() } });
        resumen.agregados++;
      } catch (e) {
        resumen.copyFallido++; // se cuenta junto a los fallidos de carga para no inflar "agregados"
        console.error(`  [${nombre}] error al cargar ${lead.correo}: ${e.message}`);
      }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, candidatos.length) }, trabajador));
  return resumen;
}

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const col = client.db(process.env.MONGODB_DB || "qivanta_chatbot").collection("leads");
    console.log(`${DRY ? "SIMULACION" : "EJECUTANDO"} cron-cargar-leads — colchón objetivo ${COLCHON_OBJETIVO}, tope por campaña ${MAX_POR_CAMPANA_POR_CORRIDA}, tope total ${MAX_TOTAL_POR_CORRIDA}`);
    let presupuesto = MAX_TOTAL_POR_CORRIDA;
    const resultados = [];
    for (const key of Object.keys(CAMPANAS)) {
      const r = await procesarCampania(col, key, presupuesto);
      presupuesto -= r.agregados;
      resultados.push(r);
      console.log(JSON.stringify(r));
    }
    console.log("\n=== RESUMEN ===");
    console.log(JSON.stringify(resultados, null, 2));
  } finally {
    await client.close();
  }
})().catch((e) => { console.error("ERR", e.stack || e.message); process.exitCode = 1; });

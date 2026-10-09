// Guardián automático de rebote: mide el rebote de los últimos 7 días de
// cada campaña nueva y ajusta su ritmo solo, sin que nadie tenga que vigilar.
//
// POR QUE (2026-10-08): Alianzas llegó a 68% de rebote y Google Maps a ~10%
// sin que nada reaccionara — hubo que pausar a mano. La auto-pausa nativa de
// Smartlead (bounce_autopause_threshold) no se puede activar por API: el
// endpoint responde 200 pero no guarda el valor. Además se confirmó que
// ningún verificador externo (Hunter ni handshake SMTP) detecta estos
// rebotes: 0 de 8 correos que YA rebotaron salieron marcados como malos,
// porque el rechazo ocurre después de aceptar el correo (reputación del
// dominio remitente, que es nuevo), no porque el buzón no exista. Lo único
// que funciona es medir el rebote REAL de lo enviado y frenar a tiempo.
//
// Decisión del usuario el 2026-10-08: "haz lo que mejor recomiendes, y sube
// todo al cron". La recomendación fue dejar Alianzas en reposo ~2 semanas
// mientras su dominio (qi-vantarush.com, ya exclusivo) acumula historial
// con el warmup, y luego reanudar a goteo midiendo el rebote — esto lo hace
// solo.
//
// Niveles por campaña, según el rebote de los últimos 7 días:
//   normal    (<= 5%)        -> hasta 40 leads nuevos/día
//   reducido  (5% a 15%)     -> hasta 10 leads nuevos/día
//   pausado   (> 15%)        -> pausa 7 días; al terminar se reanuda en
//                               "reducido" para volver a medir
// Con menos de 15 enviados en la ventana la tasa es ruido: se mantiene el
// nivel actual.
//
// Solo REANUDA campañas que el propio guardián pausó (lo registra en Mongo,
// colección cron_estado). Una campaña pausada por otra razón (a mano, por
// festivo) no se toca. Si alguien reactiva a mano una campaña durante su
// enfriamiento, el guardián lo respeta y deja de forzar la pausa.
//
// Vive en la nube: .github/workflows/cron-guardian-rebote.yml.
//
//   node scripts/cron-guardian-rebote.js          # ejecuta
//   node scripts/cron-guardian-rebote.js --dry    # solo muestra que haria
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
const { actualizarTopeCampania, actualizarEstadoCampania, obtenerEstadoRealCampania } = require("../api/_smartlead");
const { esFestivoOficialMexico } = require("../api/_feriadosMexico");

// Misma regla que verificar-feriado.js: la próxima ventana de envío es hoy
// si no ha cerrado (19:00 CDMX), si no mañana. El guardián no reanuda una
// campaña si esa ventana cae en festivo — verificar-feriado.js solo
// reactiva lo que él pausó, así que una reanudación del guardián en
// festivo enviaría correos ese día.
function proximaVentanaEsFestivo() {
  const ahoraCdmx = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
  if (ahoraCdmx.getHours() >= 19) ahoraCdmx.setDate(ahoraCdmx.getDate() + 1);
  return esFestivoOficialMexico(ahoraCdmx);
}

const DRY = process.argv.includes("--dry");
const BASE = "https://server.smartlead.ai/api/v1";

const VENTANA_DIAS = 7;
const MIN_ENVIADOS_PARA_JUZGAR = 15;
const UMBRAL_REDUCIR = 5; // %
const UMBRAL_PAUSAR = 15; // %
const LEADS_DIA = { normal: 40, reducido: 10 };
const ENFRIAMIENTO_DIAS = 7;

// enfriamientoInicial: reposo con el que arranca la campaña la PRIMERA vez
// que el guardián la ve (si ya está pausada). Alianzas: 2 semanas desde el
// 2026-10-08 para que qi-vantarush.com acumule historial con el warmup antes
// de volver a escribir a sus 174 leads sin correo alternativo. Laboratorios:
// 1 semana desde su pausa por 20% de rebote.
const CAMPANAS = [
  { id: "4093533", nombre: "Piloto LATAM" },
  { id: "4093546", nombre: "Alianzas", enfriamientoInicial: "2026-10-22T14:00:00Z" },
  { id: "4093547", nombre: "Google Maps" },
  { id: "4093548", nombre: "Laboratorios", enfriamientoInicial: "2026-10-15T14:00:00Z" },
];

function fechaISO(d) { return d.toISOString().slice(0, 10); }

async function reboteVentana(campaignId) {
  const fin = new Date();
  const inicio = new Date(fin.getTime() - (VENTANA_DIAS - 1) * 86400000);
  const r = await fetch(`${BASE}/campaigns/${campaignId}/analytics-by-date?start_date=${fechaISO(inicio)}&end_date=${fechaISO(fin)}&api_key=${encodeURIComponent(process.env.SMARTLEAD_API_KEY)}`);
  const d = await r.json().catch(() => ({}));
  const enviados = Number(d.sent_count || 0);
  const rebotes = Number(d.bounce_count || 0);
  return { enviados, rebotes, tasa: enviados ? (100 * rebotes) / enviados : 0 };
}

async function aplicarNivel(campaignId, nivel) {
  if (DRY) return;
  await actualizarTopeCampania(campaignId, LEADS_DIA[nivel]);
}

async function procesar(col, c) {
  const clave = `guardian_rebote_${c.id}`;
  const ahora = new Date();
  let estado = await col.findOne({ _id: clave });
  const real = await obtenerEstadoRealCampania(c.id);
  const guardar = async (cambios, decision) => {
    if (DRY) return;
    await col.updateOne({ _id: clave }, {
      $set: { ...cambios, campana: c.nombre, actualizadoEn: ahora },
      $push: { historial: { $each: [{ fecha: ahora, decision }], $slice: -30 } },
    }, { upsert: true });
  };

  // Primera vez: si la campaña ya está pausada y tiene reposo inicial
  // definido, el guardián la adopta con ese enfriamiento.
  if (!estado && c.enfriamientoInicial && real === "PAUSED") {
    estado = { pausadoPorGuardian: true, enfriamientoHasta: new Date(c.enfriamientoInicial), nivel: "pausado" };
    await guardar(estado, `adoptada en pausa, reposo hasta ${c.enfriamientoInicial.slice(0, 10)}`);
  }
  estado = estado || {};

  // En enfriamiento
  if (estado.enfriamientoHasta && ahora < new Date(estado.enfriamientoHasta)) {
    if (real === "ACTIVE" && estado.pausadoPorGuardian) {
      await guardar({ pausadoPorGuardian: false, enfriamientoHasta: null }, "reactivada a mano durante el reposo: se respeta");
      return { campana: c.nombre, accion: "reactivada a mano, el guardián deja de forzar la pausa" };
    }
    return { campana: c.nombre, accion: `en reposo hasta ${fechaISO(new Date(estado.enfriamientoHasta))}`, estado: real };
  }

  // Terminó el enfriamiento de una pausa propia: reanudar en reducido
  if (estado.pausadoPorGuardian && real === "PAUSED") {
    if (proximaVentanaEsFestivo()) return { campana: c.nombre, accion: "fin del reposo, pero la próxima ventana es festivo: se reanuda en la siguiente corrida" };
    await aplicarNivel(c.id, "reducido");
    if (!DRY) await actualizarEstadoCampania(c.id, "START");
    await guardar({ pausadoPorGuardian: false, enfriamientoHasta: null, nivel: "reducido" }, "fin del reposo: reanudada en reducido");
    return { campana: c.nombre, accion: `reanudada en modo reducido (${LEADS_DIA.reducido} leads/día)` };
  }

  if (real !== "ACTIVE") {
    return { campana: c.nombre, accion: "pausada por fuera del guardián (manual o festivo): no se toca", estado: real };
  }

  const r = await reboteVentana(c.id);
  const medicion = `${r.rebotes}/${r.enviados} = ${r.tasa.toFixed(1)}% en ${VENTANA_DIAS} días`;
  if (r.enviados < MIN_ENVIADOS_PARA_JUZGAR) {
    return { campana: c.nombre, accion: `pocos datos (${medicion}), se mantiene nivel ${estado.nivel || "actual"}` };
  }

  if (r.tasa > UMBRAL_PAUSAR) {
    if (!DRY) await actualizarEstadoCampania(c.id, "PAUSED");
    const hasta = new Date(ahora.getTime() + ENFRIAMIENTO_DIAS * 86400000);
    await guardar({ pausadoPorGuardian: true, enfriamientoHasta: hasta, nivel: "pausado" }, `pausada: ${medicion}`);
    return { campana: c.nombre, accion: `PAUSADA ${ENFRIAMIENTO_DIAS} días (${medicion})` };
  }

  const nivel = r.tasa > UMBRAL_REDUCIR ? "reducido" : "normal";
  if (nivel !== estado.nivel) {
    await aplicarNivel(c.id, nivel);
    await guardar({ nivel, pausadoPorGuardian: false }, `nivel ${nivel}: ${medicion}`);
    return { campana: c.nombre, accion: `nivel ${nivel} (${LEADS_DIA[nivel]} leads/día) — ${medicion}` };
  }
  return { campana: c.nombre, accion: `sin cambio, nivel ${nivel} — ${medicion}` };
}

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const col = client.db(process.env.MONGODB_DB || "qivanta_chatbot").collection("cron_estado");
    console.log(`${DRY ? "SIMULACION" : "EJECUTANDO"} guardián de rebote — ventana ${VENTANA_DIAS} días, reducir >${UMBRAL_REDUCIR}%, pausar >${UMBRAL_PAUSAR}%`);
    for (const c of CAMPANAS) {
      try {
        console.log(JSON.stringify(await procesar(col, c)));
      } catch (e) {
        console.error(JSON.stringify({ campana: c.nombre, error: e.message }));
        process.exitCode = 1;
      }
    }
  } finally {
    await client.close();
  }
})().catch((e) => { console.error("ERR", e.stack || e.message); process.exitCode = 1; });

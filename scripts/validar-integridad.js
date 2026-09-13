// Validación diaria de integridad del sistema — pedido explícito del
// usuario el 2026-09-13: "siempre que te pido algo encuentras errores y
// riesgos, eso nunca debe pasar... debes siempre diario validar que todo
// esté correctamente, sobre todo temas de duplicados en todas partes".
//
// No espera a que el usuario pida algo para encontrar un problema — corre
// solo, todos los días (ver .github/workflows/validacion-diaria.yml), y
// reporta cualquier hallazgo real. Si algún día encuentra algo, debe
// verse en el log de esa corrida de GitHub Actions.
//
// Corre como script directo (no endpoint de Vercel) por la misma razón
// que sincronizar-aperturas.js: puede necesitar más de 60s si hay que
// paginar campañas completas de Smartlead.
const fs = require("fs");
const path = require("path");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const { getDb } = require("../api/_mongo");

const SMARTLEAD_API_KEY = process.env.SMARTLEAD_API_KEY;
const SMARTLEAD_BASE = "https://server.smartlead.ai/api/v1";

let hallazgos = [];

function reportar(nivel, mensaje) {
  hallazgos.push({ nivel, mensaje });
  console.log(`[${nivel}] ${mensaje}`);
}

// Chequeo 1 y 2: duplicados dentro de nuestra propia base — mismo
// teléfono o correo guardado en más de un documento de "leads". Esto es
// lo que directamente podría causar un correo o llamada duplicada a la
// misma persona.
async function validarDuplicadosMongo(db) {
  const leadsCol = db.collection("leads");

  const dupTelefono = await leadsCol
    .aggregate([
      { $match: { telefono: { $type: "string", $ne: "" } } },
      { $group: { _id: "$telefono", count: { $sum: 1 }, nombres: { $push: "$nombre" } } },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();
  if (dupTelefono.length) {
    reportar("ERROR", `${dupTelefono.length} teléfono(s) duplicados en "leads": ${dupTelefono.slice(0, 5).map((d) => `${d._id} (${d.count}x, ej. ${d.nombres[0]})`).join("; ")}`);
  } else {
    console.log("[OK] Sin teléfonos duplicados en \"leads\".");
  }

  const dupCorreo = await leadsCol
    .aggregate([
      { $match: { correo: { $type: "string", $ne: "" } } },
      { $group: { _id: { $toLower: "$correo" }, count: { $sum: 1 }, nombres: { $push: "$nombre" } } },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();
  if (dupCorreo.length) {
    reportar("ERROR", `${dupCorreo.length} correo(s) duplicados en "leads": ${dupCorreo.slice(0, 5).map((d) => `${d._id} (${d.count}x)`).join("; ")}`);
  } else {
    console.log('[OK] Sin correos duplicados en "leads".');
  }
}

// Chequeo 3: duplicados en llamadasFrio — si el mismo teléfono aparece
// más de una vez, marcarLlamadasFrias() podría (o ya pudo) marcar/llamar
// dos veces al mismo negocio, contradiciendo "solo un intento" (pedido
// explícito del usuario el 2026-09-11).
async function validarDuplicadosLlamadas(db) {
  const dup = await db
    .collection("llamadasFrio")
    .aggregate([
      { $group: { _id: "$telefono", count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();
  if (dup.length) {
    reportar("ERROR", `${dup.length} teléfono(s) con más de un registro en "llamadasFrio" (violaría la regla de un solo intento): ${dup.map((d) => `${d._id} (${d.count}x)`).join("; ")}`);
  } else {
    console.log('[OK] Sin duplicados en "llamadasFrio".');
  }
}

// Chequeo 4: duplicados DENTRO de Smartlead mismo — si el mismo correo
// aparece 2 veces como lead distinto en la misma campaña, se le mandarían
// 2 secuencias de correo en paralelo a la misma persona. No se puede
// detectar esto reusando obtenerEstadosDeCampania() porque esa función ya
// dedupea por correo en un Map (silenciaría justo el problema que
// queremos encontrar) — aquí se pagina en crudo y se cuenta cada email.
async function validarDuplicadosSmartlead(nombre, campaignId) {
  const conteoPorCorreo = new Map();
  let offset = 0;
  const limit = 100;
  while (true) {
    const res = await fetch(`${SMARTLEAD_BASE}/campaigns/${campaignId}/leads?api_key=${encodeURIComponent(SMARTLEAD_API_KEY)}&offset=${offset}&limit=${limit}`);
    const data = await res.json();
    const pagina = data.data || [];
    for (const item of pagina) {
      const correo = item.lead?.email?.toLowerCase();
      if (!correo) continue;
      conteoPorCorreo.set(correo, (conteoPorCorreo.get(correo) || 0) + 1);
    }
    if (pagina.length < limit) break;
    offset += limit;
  }
  const duplicados = Array.from(conteoPorCorreo.entries()).filter(([, count]) => count > 1);
  if (duplicados.length) {
    reportar("ERROR", `${nombre}: ${duplicados.length} correo(s) con más de un lead dentro de la MISMA campaña de Smartlead: ${duplicados.slice(0, 5).map(([c, n]) => `${c} (${n}x)`).join("; ")}`);
  } else {
    console.log(`[OK] ${nombre}: sin correos duplicados dentro de la campaña de Smartlead (${conteoPorCorreo.size} leads revisados).`);
  }
  return conteoPorCorreo;
}

// Chequeo 5: el mismo correo contactado en LAS DOS campañas a la vez —
// no es un bug de código, pero sí sería un duplicado real de cara al
// cliente (2 correos de Qi-Vanta con enfoques distintos a la misma
// persona). Cruza los correos ya vistos en Google Maps vs. Piloto LATAM.
function validarCruceEntreCampanias(correosGM, correosLatam) {
  const cruzados = [...correosGM.keys()].filter((c) => correosLatam.has(c));
  if (cruzados.length) {
    reportar("ADVERTENCIA", `${cruzados.length} correo(s) contactados en AMBAS campañas a la vez: ${cruzados.slice(0, 5).join("; ")}`);
  } else {
    console.log("[OK] Ninguna persona contactada en las 2 campañas a la vez.");
  }
}

(async () => {
  console.log(`=== Validación diaria de integridad — ${new Date().toISOString()} ===\n`);
  const db = await getDb();

  await validarDuplicadosMongo(db);
  await validarDuplicadosLlamadas(db);
  const correosGM = await validarDuplicadosSmartlead("Google Maps", process.env.SMARTLEAD_CAMPAIGN_ID);
  const correosLatam = await validarDuplicadosSmartlead("Piloto LATAM", process.env.SMARTLEAD_CAMPAIGN_ID_LATAM);
  validarCruceEntreCampanias(correosGM, correosLatam);

  console.log(`\n=== Resultado: ${hallazgos.length} hallazgo(s) ===`);
  for (const h of hallazgos) console.log(`- [${h.nivel}] ${h.mensaje}`);

  // Sale con código de error si hay algo nivel ERROR — permite que el
  // workflow de GitHub Actions se marque en rojo y sea visible sin tener
  // que leer el log completo cada día.
  const hayErrores = hallazgos.some((h) => h.nivel === "ERROR");
  process.exit(hayErrores ? 1 : 0);
})().catch((e) => {
  console.error("ERROR FATAL en validación:", e.message);
  process.exit(1);
});

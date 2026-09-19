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

  // Un mismo teléfono en 2+ documentos SOLO es un problema real cuando es
  // el mismo negocio (nombre idéntico) duplicado por error de scrapeo —
  // cuando son negocios distintos que comparten un conmutador (ej.
  // sucursales de una misma cadena), no es un bug: el código ya
  // garantiza que ese número solo se llame una vez (dedup dentro del
  // lote + llamadasFrio persistente), así que no hay riesgo real de
  // doble contacto. Antes esto se reportaba siempre como ERROR sin
  // distinguir los dos casos, generando alertas diarias por algo que no
  // era un problema — encontrado el 2026-09-15 tras limpiar los
  // duplicados reales y seguir viendo el mismo error por los legítimos.
  const dupTelefono = await leadsCol
    .aggregate([
      { $match: { telefono: { $type: "string", $ne: "" } } },
      { $group: { _id: "$telefono", count: { $sum: 1 }, nombres: { $push: "$nombre" } } },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();
  const dupTelefonoReal = dupTelefono.filter((d) => new Set(d.nombres.map((n) => (n || "").trim().toLowerCase())).size === 1);
  const dupTelefonoCompartido = dupTelefono.length - dupTelefonoReal.length;
  if (dupTelefonoReal.length) {
    reportar("ERROR", `${dupTelefonoReal.length} teléfono(s) duplicados en "leads" (mismo negocio repetido): ${dupTelefonoReal.slice(0, 5).map((d) => `${d._id} (${d.count}x, ej. ${d.nombres[0]})`).join("; ")}`);
  } else {
    console.log("[OK] Sin teléfonos duplicados reales en \"leads\".");
  }
  if (dupTelefonoCompartido) {
    console.log(`[OK] ${dupTelefonoCompartido} teléfono(s) compartidos por negocios distintos (línea corporativa) — no es un problema, ya protegido contra doble llamada.`);
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

// Chequeo 6 (cupo compartido): detecta si una campaña ACTIVA, dentro de
// su horario de hoy, con leads EN PROGRESO (esperando seguimiento), se
// quedó en CERO envíos — señal de que otra campaña se comió todo el cupo
// compartido de las 6 cuentas de correo (40/cuenta = 240/día entre las 2
// campañas). Encontrado en real el 2026-09-18: al agotarse los créditos
// de Apollo, el tope "ampliado" de Google Maps quedó fijo en 240 (el
// cupo COMPLETO) por confundir "sin leads nuevos que agregar" con "sin
// nada que enviar" — Piloto LATAM tenía 746 leads en progreso esperando
// su seguimiento y mandó CERO correos en todo el día. Ver
// TOPE_GOOGLE_MAPS_AMPLIADO en cron-scrape-empresas.js (ya bajado a 100).
// Solo evalúa después del mediodía CDMX para no dar falso positivo temprano
// en el día, cuando todavía es normal no haber enviado nada.
async function validarCupoCompartidoSmartlead() {
  const CAMPANIAS = [
    { nombre: "Google Maps", id: process.env.SMARTLEAD_CAMPAIGN_ID },
    { nombre: "Piloto LATAM", id: process.env.SMARTLEAD_CAMPAIGN_ID_LATAM },
  ];

  const ahoraCdmx = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
  const diaSemanaCdmx = ahoraCdmx.getDay(); // 0=domingo..6=sábado
  const horaCdmx = ahoraCdmx.getHours();

  for (const { nombre, id } of CAMPANIAS) {
    if (!id) continue;
    try {
      const resInfo = await fetch(`${SMARTLEAD_BASE}/campaigns/${id}?api_key=${encodeURIComponent(SMARTLEAD_API_KEY)}`);
      const info = await resInfo.json();
      if (info.status !== "ACTIVE") {
        console.log(`[OK] ${nombre}: no está ACTIVE (${info.status}), se omite el chequeo de cupo.`);
        continue;
      }
      const dias = info.scheduler_cron_value?.days || [];
      // scheduler_cron_value usa 1=lunes..7=domingo (o 6=sábado sin domingo) — Date.getDay() usa 0=domingo.
      const diaSemanaSmartlead = diaSemanaCdmx === 0 ? 7 : diaSemanaCdmx;
      if (!dias.includes(diaSemanaSmartlead)) {
        console.log(`[OK] ${nombre}: hoy no es día programado, se omite el chequeo de cupo.`);
        continue;
      }
      const horaFin = parseInt((info.scheduler_cron_value?.endHour || "19:00").split(":")[0], 10);
      if (horaCdmx < Math.min(14, horaFin - 1)) {
        console.log(`[OK] ${nombre}: aún temprano en su horario de hoy, se omite el chequeo de cupo.`);
        continue;
      }

      let enProgreso = 0;
      let offset = 0;
      const limit = 100;
      while (true) {
        const res = await fetch(`${SMARTLEAD_BASE}/campaigns/${id}/leads?api_key=${encodeURIComponent(SMARTLEAD_API_KEY)}&offset=${offset}&limit=${limit}`);
        const data = await res.json();
        const pagina = data.data || [];
        enProgreso += pagina.filter((it) => it.status === "INPROGRESS" || it.status === "STARTED").length;
        if (pagina.length < limit) break;
        offset += limit;
      }
      if (!enProgreso) {
        console.log(`[OK] ${nombre}: sin leads en progreso esperando envío hoy.`);
        continue;
      }

      const inicioHoyCdmxUTC = new Date();
      inicioHoyCdmxUTC.setUTCHours(inicioHoyCdmxUTC.getUTCHours() - 6); // aproxima CDMX (UTC-6, sin horario de verano)
      inicioHoyCdmxUTC.setUTCHours(0, 0, 0, 0);
      inicioHoyCdmxUTC.setUTCHours(inicioHoyCdmxUTC.getUTCHours() + 6);

      let enviadosHoy = 0;
      offset = 0;
      while (true) {
        const res = await fetch(`${SMARTLEAD_BASE}/campaigns/${id}/statistics?api_key=${encodeURIComponent(SMARTLEAD_API_KEY)}&offset=${offset}&limit=${limit}`);
        const data = await res.json().catch(() => ({}));
        const pagina = data.data || [];
        if (!pagina.length) break;
        enviadosHoy += pagina.filter((it) => it.sent_time && new Date(it.sent_time) >= inicioHoyCdmxUTC).length;
        if (pagina.length < limit) break;
        offset += limit;
        if (offset > 3000) break;
      }

      if (enviadosHoy === 0) {
        reportar("ERROR", `${nombre}: ACTIVA, dentro de su horario de hoy, con ${enProgreso} lead(s) en progreso, pero 0 correos enviados hoy — probable acaparamiento del cupo compartido por la otra campaña.`);
      } else {
        console.log(`[OK] ${nombre}: ${enviadosHoy} correo(s) enviados hoy, ${enProgreso} en progreso.`);
      }
    } catch (err) {
      console.error(`Error validando cupo compartido de ${nombre}:`, err.message);
    }
  }
}

// Chequeo 7: ¿de verdad corrieron solos los demás crons hoy? — pedido
// explícito del usuario el 2026-09-14, después de que TODOS los crons de
// una sola corrida diaria (festivo, monitor, scrapeos, métricas) no se
// dispararan solos el día que se migró este repo — "debes desarrollar un
// monitor que diario este validando todo... lo que detectes diario
// arreglarlo de inmediato". No se puede saber por adelantado si un cron
// disparará (eso lo decide GitHub) — pero SÍ se puede confirmar, después
// de que ya pasó su horario esperado, si de verdad corrió. Usa la API de
// GitHub Actions con el GITHUB_TOKEN automático de la propia corrida
// (alcance de solo lectura sobre este mismo repo, no requiere secretos
// nuevos).
//
// Cada entrada: cuántas horas hacia atrás es razonable esperar encontrar
// AL MENOS una corrida exitosa. En vez de calcular el día/hora exacta de
// cada cron (frágil si se les cambia el horario), se usa una ventana
// generosa que cubre su propio patrón de días — ej. los que son
// lunes-viernes necesitan ventana suficiente para que el chequeo del
// lunes por la mañana todavía alcance a ver la última corrida real del
// viernes, cruzando el fin de semana sin corridas.
const CRONS_A_VIGILAR = [
  { archivo: "verificar-feriado.yml", ventanaHoras: 30 }, // corre todos los días
  { archivo: "cron-monitor-campanas.yml", ventanaHoras: 60 }, // lunes-sábado
  { archivo: "cron-scrape-empresas-diario.yml", ventanaHoras: 66 }, // lunes-viernes
  { archivo: "cron-scrape-diario.yml", ventanaHoras: 66 }, // lunes-viernes
  { archivo: "cron-llamadas-frias.yml", ventanaHoras: 72 }, // lunes-viernes, varias veces al día
];

async function validarCronsCorrieron() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY; // "owner/repo", ya lo da GitHub Actions
  if (!token || !repo) {
    console.log("[OK] Chequeo de crons omitido (no corre dentro de GitHub Actions, GITHUB_TOKEN/GITHUB_REPOSITORY no disponibles).");
    return;
  }

  const ahora = new Date();

  for (const cron of CRONS_A_VIGILAR) {
    const desde = new Date(ahora.getTime() - cron.ventanaHoras * 3600000);
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${cron.archivo}/runs?per_page=10`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      });
      const data = await res.json();
      const corridasRecientes = (data.workflow_runs || []).filter((r) => new Date(r.created_at) >= desde);
      const corrioBien = corridasRecientes.some((r) => r.status === "completed" && r.conclusion === "success");
      if (!corrioBien) {
        const motivo = corridasRecientes.length === 0 ? `no se registró ninguna corrida en las últimas ${cron.ventanaHoras}h (ni programada ni manual)` : `corrió pero sin éxito (última conclusion: ${corridasRecientes[0].conclusion})`;
        reportar("ERROR", `${cron.archivo}: ${motivo}.`);
      } else {
        console.log(`[OK] ${cron.archivo} tuvo al menos una corrida exitosa en las últimas ${cron.ventanaHoras}h.`);
      }
    } catch (err) {
      console.error(`Error consultando estado de ${cron.archivo}:`, err.message);
    }
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
  await validarCupoCompartidoSmartlead();
  await validarCronsCorrieron();

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

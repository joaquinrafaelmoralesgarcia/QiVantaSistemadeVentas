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

// Las 4 campañas que envían desde el 2026-10-07. Antes los chequeos de
// Smartlead apuntaban a las campañas viejas (SMARTLEAD_CAMPAIGN_ID / _LATAM
// / 3990563), ya COMPLETED: revisaban "0 leads" y se saltaban el cupo, así
// que no vigilaban nada real (encontrado el 2026-10-09).
const CAMPANAS_VIGENTES = [
  { nombre: "Piloto LATAM", id: "4093533" },
  { nombre: "Alianzas", id: "4093546" },
  { nombre: "Google Maps", id: "4093547" },
  { nombre: "Laboratorios", id: "4093548" },
];

const ESTADOS_PENDIENTES = [null, "pendiente_carga_smartlead", "bloqueado_limite_contactos_smartlead", "error"];

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

  // Duplicados de correo: se separa lo ACCIONABLE de lo histórico (cambio
  // del 2026-10-09). Accionable = esa persona todavía puede recibir otro
  // correo: dos registros pendientes, o uno pendiente y otro ya enviado.
  // Eso es ERROR. Histórico = ya se le escribió dos veces en el pasado (no
  // se puede deshacer) o los registros extra ya están bloqueados: eso es
  // ADVERTENCIA. Antes todo era ERROR y el workflow salía en rojo todos los
  // días por casos ya resueltos, sin distinguir el riesgo real.
  const dupCorreo = await leadsCol
    .aggregate([
      { $match: { correo: { $type: "string", $ne: "" } } },
      { $group: { _id: { $toLower: "$correo" }, count: { $sum: 1 }, estados: { $push: "$emailEstado" } } },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();
  const accionables = dupCorreo.filter((d) => {
    const pendientes = d.estados.filter((e) => ESTADOS_PENDIENTES.includes(e ?? null)).length;
    const enviados = d.estados.filter((e) => e === "enviado_a_campana").length;
    return pendientes >= 2 || (pendientes >= 1 && enviados >= 1);
  });
  const historicosDobles = dupCorreo.filter((d) => d.estados.filter((e) => e === "enviado_a_campana").length >= 2);
  if (accionables.length) {
    reportar("ERROR", `${accionables.length} correo(s) que todavía podrían recibir un correo repetido: ${accionables.slice(0, 5).map((d) => `${d._id} (${d.count}x)`).join("; ")}`);
  } else {
    console.log('[OK] Ningún correo pendiente que ya se haya contactado (sin riesgo de repetir).');
  }
  if (historicosDobles.length) {
    reportar("ADVERTENCIA", `${historicosDobles.length} correo(s) ya cargados en campaña más de una vez en el pasado (no se puede deshacer; el cron de carga ya lo evita): ${historicosDobles.slice(0, 5).map((d) => d._id).join("; ")}`);
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
// Generalizado el 2026-10-09 de 2 campañas a todas las vigentes.
function validarCruceEntreCampanias(porCampana) {
  const vistos = new Map();
  const cruzados = new Set();
  for (const { nombre, correos } of porCampana) {
    for (const c of correos.keys()) {
      if (vistos.has(c) && vistos.get(c) !== nombre) cruzados.add(c);
      else vistos.set(c, nombre);
    }
  }
  if (cruzados.size) {
    reportar("ADVERTENCIA", `${cruzados.size} correo(s) contactados en más de una campaña a la vez: ${[...cruzados].slice(0, 5).join("; ")}`);
  } else {
    console.log("[OK] Ninguna persona contactada en dos campañas a la vez.");
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
  const CAMPANIAS = CAMPANAS_VIGENTES;

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

// Chequeo 7 (salud de cuentas de correo): revisa las 2 formas reales en
// que una cuenta puede dejar de mandar sin que el status de la campaña
// (ACTIVE) lo refleje — pedido explícito del usuario el 2026-09-22 tras
// un incidente real: Piloto LATAM llevaba desde el jueves 2026-09-17 sin
// mandar NADA (3 días hábiles en cero) y la causa real nunca fue el
// status de la campaña (siempre dijo ACTIVE) sino:
//   1. SMTP roto (is_smtp_success:false) — login inválido con Google
//      (error 534-5.7.14), encontrado el 2026-09-19 en 4 de 6 cuentas.
//   2. Warmup en INACTIVE — encontrado el 2026-09-22: cuando el login
//      falló, Smartlead pausó el warmup de esas cuentas solo, y aunque
//      el usuario ya arregló la contraseña (SMTP volvió a true), el
//      warmup NUNCA se reactivó solo — dejando la cuenta con SMTP sano
//      pero probablemente excluida de la rotación real de envío de
//      todas formas. Ambos hallazgos son ERROR aunque el status de la
//      campaña diga ACTIVE, precisamente porque ese campo no los detecta.
async function validarSaludCuentasCorreo() {
  try {
    const res = await fetch(`${SMARTLEAD_BASE}/email-accounts/?api_key=${encodeURIComponent(SMARTLEAD_API_KEY)}&offset=0&limit=50`);
    const cuentas = await res.json();
    if (!Array.isArray(cuentas)) {
      console.error("Error validando salud de cuentas de correo: respuesta inesperada de Smartlead.");
      return;
    }
    for (const c of cuentas) {
      if (!c.is_smtp_success) {
        reportar("ERROR", `Cuenta de correo ${c.from_email}: SMTP roto (login inválido) — no puede enviar aunque la campaña diga ACTIVE.`);
        continue;
      }
      const warmupStatus = c.warmup_details?.status;
      if (warmupStatus && warmupStatus !== "ACTIVE") {
        reportar("ERROR", `Cuenta de correo ${c.from_email}: warmup en ${warmupStatus} (no ACTIVE) — probablemente excluida de la rotación real de envío.`);
        continue;
      }
      // BUZON MUDO: el warmup esta ACTIVO pero no ha salido ni un correo.
      // Smartlead reporta la cuenta sana (is_smtp_success, warmup ACTIVE) y
      // acepta cada envio con "success", pero no transmite nada.
      //
      // OJO con el campo: warmup_details.total_sent_count viene SIEMPRE en 0
      // en /email-accounts — es un campo muerto. El numero real solo esta en
      // /email-accounts/{id}/warmup-stats. El 2026-10-02 esa confusion me hizo
      // creer durante un dia que 3 buzones nuevos no enviaban nada, cuando el
      // warmup llevaba 24-26 correos entregados a bandeja de entrada. Si vuelve
      // a tocarse este chequeo: NO confiar en total_sent_count del objeto cuenta.
      const w = c.warmup_details || {};
      const horasDeWarmup = w.created_at ? (Date.now() - new Date(w.created_at).getTime()) / 3600000 : 0;
      if (warmupStatus === "ACTIVE" && horasDeWarmup > 12) {
        let enviadosReales = null;
        try {
          const rs = await fetch(`${SMARTLEAD_BASE}/email-accounts/${c.id}/warmup-stats?api_key=${encodeURIComponent(SMARTLEAD_API_KEY)}`);
          const st = await rs.json();
          enviadosReales = parseInt(st.sent_count, 10);
        } catch { /* si falla la consulta no se inventa una alarma */ }
        if (enviadosReales === 0) {
          reportar(
            "ERROR",
            `Cuenta de correo ${c.from_email}: BUZON MUDO — warmup ACTIVO desde hace ${Math.round(horasDeWarmup)}h y 0 correos enviados de verdad. ` +
              `Smartlead la reporta sana pero no transmite. Revisar antes de activar campanas con esta cuenta.`
          );
          continue;
        }
      }
      console.log(`[OK] ${c.from_email}: SMTP sano, warmup ${warmupStatus || "sin warmup configurado"}.`);
    }
  } catch (err) {
    console.error("Error validando salud de cuentas de correo:", err.message);
  }
}

// Chequeo 8: ¿de verdad corrieron solos los demás crons hoy? — pedido
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
// Subido de 66 a 90h el 2026-09-21 tras un falso positivo real: GitHub
// Actions sigue disparando los crons programados ~5h tarde (patrón ya
// conocido, ver comentario de cron-scrape-empresas-diario.yml) — este
// MISMO chequeo diario también se dispara tarde. El lunes 2026-09-21 el
// chequeo corrió a las 18:26 UTC (programado 13:00 UTC), y la última
// corrida real de cron-scrape-empresas-diario.yml era del viernes
// 17:12 UTC (también tarde, programado 13:45 UTC) — 73h14min de
// diferencia, más que las 66h de ventana. La corrida real del lunes
// llegó 28 minutos después del chequeo (18:54 UTC), o sea SÍ estaba
// corriendo bien, solo que el chequeo la buscó demasiado pronto. 90h da
// margen a que ambos extremos (la corrida del viernes Y el chequeo del
// lunes) lleguen tarde sin que se dispare una alarma falsa.
const CRONS_A_VIGILAR = [
  { archivo: "verificar-feriado.yml", ventanaHoras: 30 }, // corre todos los días
  { archivo: "cron-monitor-campanas.yml", ventanaHoras: 60 }, // lunes-sábado
  { archivo: "cron-scrape-empresas-diario.yml", ventanaHoras: 90 }, // lunes-viernes
  { archivo: "cron-scrape-diario.yml", ventanaHoras: 90 }, // lunes-viernes
  { archivo: "cron-llamadas-frias.yml", ventanaHoras: 72 }, // lunes-viernes, varias veces al día
  { archivo: "cron-notificar-respuestas.yml", ventanaHoras: 60 }, // lunes-sábado, cada 30 min
  { archivo: "cron-rampa-envios.yml", ventanaHoras: 36 }, // todos los días
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
  const porCampana = [];
  for (const { nombre, id } of CAMPANAS_VIGENTES) {
    porCampana.push({ nombre, correos: await validarDuplicadosSmartlead(nombre, id) });
  }
  validarCruceEntreCampanias(porCampana);
  await validarCupoCompartidoSmartlead();
  await validarSaludCuentasCorreo();
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

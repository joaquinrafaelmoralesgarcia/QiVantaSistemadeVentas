// CANARIO DE ENTREGA: comprueba de verdad si los buzones de SmartSenders
// entregan correo, en vez de confiar en lo que reporta Smartlead.
//
// Por que existe: del 2026-10-01 al 2026-10-02 los buzones nuevos de
// qi-vantanova.com / qi-vantaedge.com / qi-vantarush.com aceptaron todos los
// envios con status "success", Microsoft los acepto, aparecieron en Elementos
// enviados... y NO llegaron a ningun destinatario, sin rebote. Lo unico que
// si llegaba eran los correos escritos a mano desde Outlook web.
//
// Smartlead no puede ver lo que pasa despues de que Microsoft acepta, asi que
// la unica verificacion real es mirar la bandeja de DESTINO. Eso hace esto:
// manda un correo por la ruta real de campana y luego revisa por IMAP si
// aparecio. Sin este chequeo, la unica forma de saberlo era preguntarle al
// usuario "¿ya te llego?" una y otra vez.
//
//   node scripts/canario-entrega.js            # manda y deja la marca pendiente
//   node scripts/canario-entrega.js --revisar  # solo revisa las marcas pendientes
const fs = require("fs");
const path = require("path");
const { ImapFlow } = require("imapflow");

const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

const SOLO_REVISAR = process.argv.includes("--revisar");
const KEY = process.env.SMARTLEAD_API_KEY;
const BASE = "https://server.smartlead.ai/api/v1";
const DESTINO = process.env.GMAIL_USER; // la bandeja que SI podemos leer por IMAP
const ARCHIVO_MARCAS = path.join(__dirname, "..", ".canario-marcas.json");

// Horas que se le dan a un correo para aparecer antes de declararlo perdido.
// Un envio normal llega en segundos; 2h es holgado y evita falsos negativos
// por retrasos del cron de Smartlead o greylisting del receptor.
// Configurable por entorno: en GitHub Actions el job no puede esperar 2h,
// asi que ahi se baja a ~0.3h. En local 2h evita falsos negativos.
// Buzones bloqueados por Microsoft (5.1.8) con solicitud de liberación abierta
// en Smartlead (#411627, 2026-10-11). Soporte pidió explícitamente que NO
// hagan más intentos de envío: cada intento rechazado entorpece la
// liberación. Quitarlos de aquí cuando Smartlead confirme que se liberaron.
// 2026-10-14: Smartlead (chat #416412) confirmo que los 3 fueron liberados, asi
// que la lista queda vacia y el canario vuelve a probarlos. Si Microsoft los
// bloquea otra vez, el propio canario los retira de las campanas.
// Canario del mismo dia (2026-10-14): solutions@qi-vantanova SI entrega, pero
// transformation@qi-vantaedge y automation@qi-vantarush siguen con 5.1.8. Se
// vuelven a excluir hasta que Smartlead confirme y el canario los pruebe bien.
const BUZONES_EN_LIBERACION = [
  "automation.qivanta@qi-vantarush.com",
  "transformation.qivanta@qi-vantaedge.com",
];
const HORAS_DE_GRACIA =parseFloat(process.env.CANARIO_HORAS_DE_GRACIA || "2");

async function api(metodo, ruta, cuerpo) {
  const sep = ruta.includes("?") ? "&" : "?";
  const res = await fetch(`${BASE}${ruta}${sep}api_key=${encodeURIComponent(KEY)}`, {
    method: metodo,
    headers: { "Content-Type": "application/json" },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await res.text();
  let json;
  try { json = JSON.parse(texto); } catch { json = { raw: texto.slice(0, 200) }; }
  return { ok: res.ok, status: res.status, json };
}

function leerMarcas() {
  try { return JSON.parse(fs.readFileSync(ARCHIVO_MARCAS, "utf8")); } catch { return []; }
}
function guardarMarcas(m) {
  fs.writeFileSync(ARCHIVO_MARCAS, JSON.stringify(m, null, 2));
}

// Manda un correo por la RUTA REAL de campana — no por send-test-email, que
// usa otro camino y no sirve como prueba de entrega.
async function enviarCanario(cuentaId, fromEmail) {
  const marca = "CANARIO-" + Math.random().toString(36).slice(2, 8).toUpperCase();
  const camp = await api("POST", "/campaigns/create", { name: `ZZ Canario ${marca}`, client_id: null });
  const id = camp.json.id;
  if (!id) throw new Error("no se pudo crear la campana del canario");

  await api("POST", `/campaigns/${id}/sequences`, {
    sequences: [{
      seq_number: 1,
      seq_delay_details: { delay_in_days: 1 },
      subject: `${marca} canario de entrega`,
      email_body: `<p>Marca ${marca}. Verificacion automatica de entrega desde ${fromEmail}.</p>`,
    }],
  });
  await api("POST", `/campaigns/${id}/schedule`, {
    timezone: "America/Mexico_City", days_of_the_week: [0, 1, 2, 3, 4, 5, 6],
    start_hour: "00:00", end_hour: "23:59", min_time_btw_emails: 3, max_new_leads_per_day: 10,
  });
  await api("POST", `/campaigns/${id}/email-accounts`, { email_account_ids: [cuentaId] });
  // ignore_duplicate_leads_in_other_campaign: el destino es siempre el mismo
  // Gmail, y Smartlead por defecto DESCARTA en silencio un lead que ya existe
  // en otra campaña. Encontrado el 2026-10-09: desde el segundo canario,
  // todas las campañas canario quedaban sin lead (sent=0, COMPLETED) y el
  // canario reportaba "PERDIDO" como si fuera un problema de entrega, cuando
  // nunca se había enviado nada. Por eso además se verifica upload_count.
  // ignore_global_block_list: el destino (nuestro propio buzón) está en la
  // lista de bloqueo global de Smartlead — la respuesta traía block_count: 1
  // y el lead se descartaba aunque upload_count dijera 1. Es seguro
  // ignorarla aquí porque el único destinatario es nuestro buzón.
  // Dirección ÚNICA por canario (sub-dirección con "+", que Google Workspace
  // entrega al mismo buzón). Smartlead no deja el mismo destinatario en dos
  // campañas activas aunque se le pida ignorar duplicados
  // (skipped_in_other_campaign_count: 1, probado el 2026-10-09), así que con
  // el mismo correo solo el primer canario del día entraba.
  const destinoUnico = DESTINO.replace("@", `+${marca.toLowerCase()}@`);
  const alta = await api("POST", `/campaigns/${id}/leads`, {
    lead_list: [{ email: destinoUnico, first_name: "Canario", company_name: "Qi-Vanta" }],
    settings: { ignore_duplicate_leads_in_other_campaign: true, ignore_global_block_list: true },
  });
  // upload_count NO confirma nada (cuenta intentos, no altas). Se verifica
  // que el lead esté de verdad dentro de la campaña.
  const enCampana = await api("GET", `/campaigns/${id}/leads?offset=0&limit=5`);
  if (!(enCampana.json?.data || []).length) {
    throw new Error(`Smartlead no agregó el lead del canario (campaña ${id}): ${JSON.stringify(alta.json).slice(0, 220)}`);
  }
  await api("POST", `/campaigns/${id}/status`, { status: "START" });
  return { marca, campaignId: id, cuentaId, fromEmail, enviado: new Date().toISOString() };
}

// Busca la marca en la bandeja de destino. Mira Recibidos Y Spam: caer en spam
// es un resultado distinto de no llegar, y hay que poder distinguirlos.
async function buscarMarcas(marcas) {
  const c = new ImapFlow({
    host: "imap.gmail.com", port: 993, secure: true,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    logger: false,
  });
  await c.connect();
  const hallazgos = new Map();
  try {
    for (const buzon of ["INBOX", "[Gmail]/Spam"]) {
      let lock;
      try { lock = await c.getMailboxLock(buzon); } catch { continue; }
      try {
        const desde = new Date(Date.now() - 72 * 3600 * 1000);
        const ids = await c.search({ since: desde });
        if (!ids.length) continue;
        for await (const msg of c.fetch(ids, { envelope: true })) {
          const asunto = msg.envelope?.subject || "";
          for (const m of marcas) {
            if (asunto.includes(m.marca)) hallazgos.set(m.marca, buzon);
          }
        }
      } finally { lock.release(); }
    }
  } finally { await c.logout(); }
  return hallazgos;
}

// Rebote de Microsoft que significa "este buzón tiene prohibido enviar"
// (restricted sender). Visto por primera vez el 2026-10-09 en
// automation@qi-vantarush.com: 100% de sus envíos rechazados desde el día
// 1, y eso pasaba como "68% de rebote de Alianzas" sin que nadie supiera
// que el problema era un solo buzón.
const BLOQUEO_MICROSOFT = /5\.1\.8|bad outbound sender/i;

async function rebotePorBloqueo(m) {
  const L = await api("GET", `/campaigns/${m.campaignId}/leads?offset=0&limit=5`);
  const lead = (L.json?.data || [])[0];
  if (!lead) return null;
  const h = await api("GET", `/campaigns/${m.campaignId}/leads/${lead.lead.id}/message-history`);
  const r = (h.json?.history || []).find((x) => x.type === "REPLY" && BLOQUEO_MICROSOFT.test(x.email_body || ""));
  return r ? ((r.email_body || "").replace(/<[^>]+>/g, " ").match(/5\.1\.8[^<]{0,60}/) || ["5.1.8"])[0].trim() : null;
}

// Campañas vigentes de las que se retira un buzón bloqueado, para que no
// siga mandando correos que rebotan (y dañan la reputación del dominio).
const CAMPANAS_VIGENTES = ["4093533", "4093546", "4093547", "4093548"];

async function retirarDeCampanas(cuentaId) {
  const retiradas = [];
  for (const id of CAMPANAS_VIGENTES) {
    const acc = await api("GET", `/campaigns/${id}/email-accounts`);
    const asignadas = Array.isArray(acc.json) ? acc.json : [];
    if (!asignadas.some((a) => a.id === cuentaId)) continue;
    // Nunca dejar una campaña sin ningún buzón: si es el único, se avisa
    // pero no se retira (pausar o reemplazar es decisión del usuario).
    if (asignadas.length <= 1) { retiradas.push(`${id} (NO retirado: es su único buzón)`); continue; }
    await api("DELETE", `/campaigns/${id}/email-accounts`, { email_account_ids: [cuentaId] });
    retiradas.push(id);
  }
  return retiradas;
}

(async () => {
  if (!DESTINO || !process.env.GMAIL_APP_PASSWORD) {
    console.error("Falta GMAIL_USER / GMAIL_APP_PASSWORD — sin eso no se puede verificar la entrega.");
    process.exit(1);
  }

  let marcas = leerMarcas();

  if (!SOLO_REVISAR) {
    const lista = await api("GET", "/email-accounts/?offset=0&limit=100");
    const cuentas = (Array.isArray(lista.json) ? lista.json : []).filter((a) => {
      const d = ((a.from_email || "").split("@")[1] || "").toLowerCase();
      return !["qi-vanta.com", "qi-vantatech.com"].includes(d) && !BUZONES_EN_LIBERACION.includes((a.from_email || "").toLowerCase());
    });
    // Un canario por DOMINIO, no por buzon: el problema se ha comportado
    // siempre a nivel de dominio/tenant, y asi no se gasta cupo de envio.
    // Un canario por BUZÓN (cambio del 2026-10-09). Antes era uno por
    // dominio, pero el bloqueo de Microsoft resultó ser por buzón:
    // automation@qi-vantarush.com estuvo bloqueado desde el primer día
    // (550 5.1.8 bad outbound sender) mientras strategy@, del mismo dominio,
    // entregaba bien, y el canario por dominio nunca lo habría visto.
    // Se omite un buzón sin cupo libre hoy: no mandaría el canario hasta
    // mañana y saldría "PERDIDO" sin serlo.
    const libre = (a) => (a.message_per_day || 0) - (a.daily_sent_count || 0);
    const porDominio = new Map();
    for (const a of cuentas) {
      if (libre(a) <= 0) { console.log(`omitido ${a.from_email}: sin cupo libre hoy (${a.daily_sent_count}/${a.message_per_day})`); continue; }
      porDominio.set(a.from_email, a);
    }
    for (const [dominio, a] of porDominio) {
      try {
        const m = await enviarCanario(a.id, a.from_email);
        marcas.push(m);
        console.log(`enviado canario ${m.marca} desde ${dominio} (campana ${m.campaignId})`);
      } catch (e) {
        // Antes solo se registraba y el job salía en verde: así pasaron días
        // sin que ningún canario se enviara (lead bloqueado en Smartlead)
        // sin que nada lo marcara. Un canario que no sale es un error.
        console.error(`ERROR no se pudo enviar canario desde ${dominio}: ${e.message}`);
        process.exitCode = 1;
      }
    }
    guardarMarcas(marcas);
    console.log(`\n${porDominio.size} canario(s) en vuelo. Revisar con --revisar en ~${HORAS_DE_GRACIA}h.`);
    return;
  }

  const pendientes = marcas.filter((m) => !m.resultado);
  if (!pendientes.length) { console.log("No hay canarios pendientes."); return; }

  const hallazgos = await buscarMarcas(pendientes);
  let perdidos = 0;
  for (const m of pendientes) {
    const donde = hallazgos.get(m.marca);
    const horas = (Date.now() - new Date(m.enviado).getTime()) / 3600000;
    if (donde) {
      m.resultado = donde === "INBOX" ? "entregado" : "spam";
      console.log(`${m.marca} (${m.fromEmail}): ${m.resultado.toUpperCase()}`);
      // Spam no tumba el job (el correo sí sale), pero se marca como aviso
      // visible en GitHub: es señal de que ese buzón necesita warmup.
      if (m.resultado === "spam") console.log(`::warning::Canario de ${m.fromEmail} cayó en SPAM`);
    } else if (await rebotePorBloqueo(m).catch(() => null)) {
      // Un rechazo 5.1.8 es definitivo: no hace falta esperar el plazo.
      const detalle = await rebotePorBloqueo(m).catch(() => "5.1.8");
      const retiradas = await retirarDeCampanas(m.cuentaId).catch((e) => [`error al retirar: ${e.message}`]);
      m.resultado = "bloqueado_microsoft";
      perdidos++;
      console.error(`ERROR ${m.marca} (${m.fromEmail}): BLOQUEADO POR MICROSOFT para enviar (${detalle}). Retirado de campañas: ${retiradas.join(", ") || "ninguna asignada"}. Hay que pedir a Smartlead/SmartSenders que lo desbloqueen.`);
    } else if (horas >= HORAS_DE_GRACIA) {
      m.resultado = "perdido";
      perdidos++;
      console.error(`ERROR ${m.marca} (${m.fromEmail}): PERDIDO — ${horas.toFixed(1)}h sin aparecer ni en Recibidos ni en Spam.`);
    } else {
      console.log(`${m.marca} (${m.fromEmail}): aun en vuelo (${horas.toFixed(1)}h de ${HORAS_DE_GRACIA}h)`);
    }
  }
  guardarMarcas(marcas);
  if (perdidos > 0) process.exitCode = 1;
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });

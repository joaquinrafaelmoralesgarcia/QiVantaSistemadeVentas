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
const HORAS_DE_GRACIA = 2;

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
  await api("POST", `/campaigns/${id}/leads`, {
    lead_list: [{ email: DESTINO, first_name: "Canario", company_name: "Qi-Vanta" }],
  });
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
      return !["qi-vanta.com", "qi-vantatech.com"].includes(d);
    });
    // Un canario por DOMINIO, no por buzon: el problema se ha comportado
    // siempre a nivel de dominio/tenant, y asi no se gasta cupo de envio.
    const porDominio = new Map();
    for (const a of cuentas) {
      const d = (a.from_email.split("@")[1] || "").toLowerCase();
      if (!porDominio.has(d)) porDominio.set(d, a);
    }
    for (const [dominio, a] of porDominio) {
      try {
        const m = await enviarCanario(a.id, a.from_email);
        marcas.push(m);
        console.log(`enviado canario ${m.marca} desde ${dominio} (campana ${m.campaignId})`);
      } catch (e) {
        console.error(`no se pudo enviar canario desde ${dominio}: ${e.message}`);
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

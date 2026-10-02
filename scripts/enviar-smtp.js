// FASE 1 — Enviar los seguimientos por SMTP directo, sin pasar por el
// enviador de Smartlead.
//
// Por que existe: desde el 2026-10-01 los buzones de SmartSenders no entregan
// NADA cuando el envio lo dispara Smartlead (su ruta OAuth/Graph). Microsoft
// acepta el mensaje, aparece en Elementos enviados, y se pierde sin rebote.
// El 2026-10-02 comprobamos que el MISMO buzon, por SMTP directo
// (smtp.office365.com), entrega a bandeja de entrada en segundos: 8 de 8
// buzones, verificado por IMAP. Soporte de Smartlead lo tiene escalado a un
// Message Trace de Microsoft, sin fecha.
//
// Que hace: toma los leads que ya recibieron el correo 1 y les manda el
// seguimiento que les toca, usando el texto guardado en Smartlead
// (qi_vanta_followup1 / qi_vanta_followup2).
//
// OJO con el inventario: casi NINGUN lead tiene ese texto guardado. En una
// revision de 400 leads de Piloto LATAM el 2026-10-02, solo 1 lo tenia — los
// demas se cargaron antes de que el sistema guardara esos campos, y la API de
// Smartlead los devuelve con custom_fields vacio. O sea que este script, hoy,
// encuentra casi nada que enviar. Para usarlo de verdad hay que generar los
// seguimientos primero (DeepInfra) o escribir una plantilla fija.
//
// Que NO hace (a proposito):
//   - No manda primeros correos. Para eso hacen falta leads nuevos (Apollo/
//     Apify) y DeepInfra para redactarlos.
//   - No reemplaza el warmup de Smartlead, que sigue corriendo aparte.
//
// Reglas de seguridad, en orden:
//   1. Nunca manda a quien ya respondio, se dio de baja, o fue categorizado.
//   2. Nunca manda dos veces el mismo paso al mismo lead (registro en Mongo).
//   3. Respeta el tope diario por buzon que marca Smartlead (message_per_day).
//   4. Espacia los envios para no disparar la cuota en tres minutos.
//   5. Reply-To a la bandeja que SI podemos leer, porque el IMAP de estos
//      buzones esta deshabilitado en el tenant.
//
//   node scripts/enviar-smtp.js            # SIMULACION (no manda nada)
//   node scripts/enviar-smtp.js --apply    # envia de verdad
//   node scripts/enviar-smtp.js --apply --max 10
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");
const { MongoClient } = require("mongodb");

const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

const APLICAR = process.argv.includes("--apply");
const iMax = process.argv.indexOf("--max");
const MAX_TOTAL = iMax > -1 ? parseInt(process.argv[iMax + 1], 10) : Infinity;

const KEY = process.env.SMARTLEAD_API_KEY;
const BASE = "https://server.smartlead.ai/api/v1";
const RESPUESTAS_A = process.env.GMAIL_USER; // bandeja legible por IMAP

const CAMPANIAS = [
  { nombre: "Piloto LATAM", id: process.env.SMARTLEAD_CAMPAIGN_ID_LATAM },
  { nombre: "Google Maps", id: process.env.SMARTLEAD_CAMPAIGN_ID },
  { nombre: "Alianzas", id: "3990563" },
];

// Retraso entre pasos, en dias. Coincide con lo configurado en las 3 campanas
// (paso1:0d paso2:7d paso3:7d). Se deja en codigo y no se lee de la API para
// que un cambio accidental en Smartlead no dispare seguimientos antes de
// tiempo sobre leads reales.
const DIAS_ENTRE_PASOS = 7;

// Segundos entre un envio y el siguiente. Mandar 40 correos seguidos desde
// dominios nuevos es exactamente como se queman: Microsoft y los receptores
// miran la rafaga, no solo el volumen diario.
const SEGUNDOS_ENTRE_ENVIOS = 90;

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(ruta) {
  const sep = ruta.includes("?") ? "&" : "?";
  const res = await fetch(`${BASE}${ruta}${sep}api_key=${encodeURIComponent(KEY)}`);
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

function claveCredencial(correo) {
  const [local, dom] = correo.split("@");
  return `BUZON_${local}_${dom.split(".")[0]}`.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
}

// Buzones disponibles hoy, con cuanto cupo les queda segun Smartlead.
async function buzonesDisponibles() {
  const lista = await api("/email-accounts/?offset=0&limit=100");
  const cuentas = (Array.isArray(lista) ? lista : []).filter((a) => {
    const d = ((a.from_email || "").split("@")[1] || "").toLowerCase();
    return !["qi-vanta.com", "qi-vantatech.com"].includes(d);
  });
  const buzones = [];
  for (const a of cuentas) {
    const pass = process.env[claveCredencial(a.from_email)];
    if (!pass) { console.warn(`  (sin credencial para ${a.from_email}, se omite)`); continue; }
    if (!a.is_smtp_success) { console.warn(`  (${a.from_email} con SMTP marcado como roto, se omite)`); continue; }
    const cupo = Math.max(0, (a.message_per_day || 0) - (a.daily_sent_count || 0));
    buzones.push({ id: a.id, correo: a.from_email, nombre: a.from_name, firma: a.signature || "", pass, cupo });
  }
  return buzones;
}

// Que paso le toca a este lead, o null si no le toca ninguno.
// Se apoya en el historial REAL de Smartlead, no en lo que creamos saber.
async function pasoQueToca(campaignId, leadId) {
  const h = await api(`/campaigns/${campaignId}/leads/${leadId}/message-history`);
  const mensajes = h?.history || h?.data || [];
  if (!Array.isArray(mensajes) || !mensajes.length) return null;

  // Si contesto alguna vez, no se le sigue escribiendo. Esto es lo que
  // Smartlead hacia con stop_lead_settings REPLY_TO_AN_EMAIL.
  if (mensajes.some((m) => String(m.type).toUpperCase() === "REPLY")) return null;

  const enviados = mensajes.filter((m) => String(m.type).toUpperCase() === "SENT");
  if (!enviados.length) return null;

  const ultimo = enviados.reduce((a, b) => ((a.email_seq_number || 0) > (b.email_seq_number || 0) ? a : b));
  const siguiente = (ultimo.email_seq_number || 1) + 1;
  if (siguiente > 3) return null; // la secuencia tiene 3 pasos

  const fecha = new Date(ultimo.time || ultimo.sent_time || ultimo.created_at || 0);
  const dias = (Date.now() - fecha.getTime()) / 86400000;
  if (dias < DIAS_ENTRE_PASOS) return null;

  return { paso: siguiente, diasDesdeUltimo: Math.floor(dias) };
}

function contenidoDelPaso(custom, paso) {
  if (paso === 2) return { asunto: custom.qi_vanta_followup1_subject, cuerpo: custom.qi_vanta_followup1 };
  if (paso === 3) return { asunto: custom.qi_vanta_followup2_subject, cuerpo: custom.qi_vanta_followup2 };
  return { asunto: null, cuerpo: null };
}

(async () => {
  if (!RESPUESTAS_A) { console.error("Falta GMAIL_USER: sin eso no hay a donde dirigir las respuestas."); process.exit(1); }

  console.log(`${APLICAR ? "ENVIANDO" : "SIMULACION"} — seguimientos por SMTP directo\n`);

  const buzones = await buzonesDisponibles();
  const cupoTotal = buzones.reduce((s, b) => s + b.cupo, 0);
  console.log(`Buzones listos: ${buzones.length} | cupo disponible hoy: ${cupoTotal}`);
  buzones.forEach((b) => console.log(`  ${b.correo} — ${b.cupo} disponibles`));
  if (!cupoTotal) { console.log("\nSin cupo hoy. Nada que hacer."); return; }

  const mongo = new MongoClient(process.env.MONGODB_URI);
  await mongo.connect();
  const db = mongo.db(process.env.MONGODB_DB);
  const col = db.collection("enviosSmtp");
  await col.createIndex({ leadId: 1, paso: 1 }, { unique: true }).catch(() => {});

  const aEnviar = [];
  const tope = Math.min(cupoTotal, MAX_TOTAL);

  for (const camp of CAMPANIAS) {
    if (aEnviar.length >= tope) break;
    if (!camp.id) continue;
    console.log(`\n--- ${camp.nombre} ---`);
    let offset = 0;
    let revisados = 0;
    while (aEnviar.length < tope) {
      const pagina = await api(`/campaigns/${camp.id}/leads?offset=${offset}&limit=100`);
      const filas = pagina?.data || [];
      if (!filas.length) break;
      offset += filas.length;

      for (const fila of filas) {
        if (aEnviar.length >= tope) break;
        const lead = fila.lead || {};
        revisados++;

        if (String(fila.status).toUpperCase() !== "INPROGRESS") continue;
        if (lead.is_unsubscribed) continue;
        if (fila.lead_category_id !== null && fila.lead_category_id !== undefined) continue;

        const custom = lead.custom_fields || {};
        if (!custom.qi_vanta_followup1) continue; // sin texto guardado no hay nada que mandar

        const toca = await pasoQueToca(camp.id, lead.id);
        if (!toca) continue;

        const { asunto, cuerpo } = contenidoDelPaso(custom, toca.paso);
        if (!asunto || !cuerpo) continue;

        const yaEnviado = await col.findOne({ leadId: lead.id, paso: toca.paso });
        if (yaEnviado) continue;

        aEnviar.push({ campania: camp.nombre, campaignId: camp.id, lead, paso: toca.paso, asunto, cuerpo, diasDesdeUltimo: toca.diasDesdeUltimo });
      }
      console.log(`  revisados ${revisados}, listos para enviar ${aEnviar.length}`);
      if (filas.length < 100) break;
    }
  }

  console.log(`\n=== ${aEnviar.length} seguimiento(s) por enviar ===`);
  for (const x of aEnviar.slice(0, 10)) {
    console.log(`  [${x.campania}] paso ${x.paso} -> ${x.lead.email} (${x.diasDesdeUltimo}d desde el anterior)`);
  }
  if (aEnviar.length > 10) console.log(`  ... y ${aEnviar.length - 10} mas`);

  if (!APLICAR) {
    console.log("\nSIMULACION: no se envio nada. Usa --apply para enviar.");
    await mongo.close();
    return;
  }

  let enviados = 0, fallidos = 0;
  let iBuzon = 0;
  for (const x of aEnviar) {
    // Rotacion: busca el siguiente buzon con cupo.
    let b = null;
    for (let i = 0; i < buzones.length; i++) {
      const cand = buzones[(iBuzon + i) % buzones.length];
      if (cand.cupo > 0) { b = cand; iBuzon = (iBuzon + i + 1) % buzones.length; break; }
    }
    if (!b) { console.log("Se acabo el cupo de todos los buzones."); break; }

    try {
      const t = nodemailer.createTransport({
        host: "smtp.office365.com", port: 587, secure: false,
        auth: { user: b.correo, pass: b.pass },
      });
      const info = await t.sendMail({
        from: `"${b.nombre}" <${b.correo}>`,
        to: x.lead.email,
        replyTo: RESPUESTAS_A,
        subject: x.asunto,
        html: `<div style="white-space:pre-wrap">${x.cuerpo}</div>${b.firma}`,
      });
      await col.insertOne({
        leadId: x.lead.id, paso: x.paso, correo: x.lead.email, campania: x.campania,
        campaignId: x.campaignId, buzon: b.correo, messageId: info.messageId, enviado: new Date(),
      });
      b.cupo--;
      enviados++;
      console.log(`${enviados}. ${x.lead.email} paso ${x.paso} desde ${b.correo}`);
    } catch (e) {
      fallidos++;
      console.error(`   FALLO ${x.lead.email}: ${(e.message || "").slice(0, 120)}`);
    }

    if (enviados + fallidos < aEnviar.length) await espera(SEGUNDOS_ENTRE_ENVIOS * 1000);
  }

  console.log(`\n=== enviados: ${enviados} | fallidos: ${fallidos} ===`);
  await mongo.close();
  if (fallidos > 0) process.exitCode = 1;
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });

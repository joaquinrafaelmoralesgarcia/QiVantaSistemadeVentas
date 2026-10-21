// Envío de correo interno de notificación (leads del chat web) vía SMTP de
// Gmail/Google Workspace con App Password — no vía Smartlead, porque
// Smartlead es para campañas salientes (throttling de cuenta trial, límites
// por campaña) y esto es una notificación transaccional inmediata.
const nodemailer = require("nodemailer");

let transporter = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });
  }
  return transporter;
}

// "to" opcional. Todas las notificaciones internas van por defecto a
// joaquin.morales@qi-vanta.com; cada llamada puede reemplazarlo si hace falta.
//
// 2026-10-21: GMAIL_USER ES joaquin.morales@qi-vanta.com. Un correo que la
// cuenta se manda a si misma por SMTP, Gmail lo archiva en "Enviados" y NO
// aparece en Recibidos: por eso el usuario nunca veia las notificaciones de
// respuestas aunque el cron reportara "notificada". Cuando el destino es la
// misma cuenta, el mensaje se DEPOSITA por IMAP directo en INBOX, sin leer.
// Si el IMAP falla, cae al envio SMTP de antes (mejor en Enviados que perdido).
async function depositarEnBandeja({ asunto, texto, to }) {
  const MailComposer = require("nodemailer/lib/mail-composer");
  const { ImapFlow } = require("imapflow");
  const raw = await new MailComposer({
    from: `Qi-Vanta Notificaciones <${process.env.GMAIL_USER}>`, to, subject: asunto, text: texto, date: new Date(),
  }).compile().build();
  const cliente = new ImapFlow({
    host: "imap.gmail.com", port: 993, secure: true, logger: false,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
  await cliente.connect();
  try { await cliente.append("INBOX", raw, []); } finally { await cliente.logout(); }
}

async function enviarCorreoInterno({ asunto, texto, to = "joaquin.morales@qi-vanta.com" }) {
  const aSiMismo = (to || "").toLowerCase().replace(/\+[^@]*@/, "@") === (process.env.GMAIL_USER || "").toLowerCase();
  if (aSiMismo) {
    try { await depositarEnBandeja({ asunto, texto, to }); return; }
    catch (e) { console.error("No se pudo depositar en INBOX por IMAP, se envia por SMTP:", e.message); }
  }
  await getTransporter().sendMail({
    from: process.env.GMAIL_USER,
    to,
    subject: asunto,
    text: texto,
  });
}

module.exports = { enviarCorreoInterno };

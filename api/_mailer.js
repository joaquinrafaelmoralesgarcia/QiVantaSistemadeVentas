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

// "to" opcional (default info@qi-vanta.com, sin cambios para los usos ya
// existentes de chat-lead.js/cron-monitor-campanas.js) — pedido explícito
// del usuario el 2026-09-26: las notificaciones de RESPUESTAS de correo
// (scripts/notificar-respuestas.js) ahora van a joaquin.morales@qi-vanta.com
// en vez de info@qi-vanta.com.
async function enviarCorreoInterno({ asunto, texto, to = "info@qi-vanta.com" }) {
  await getTransporter().sendMail({
    from: process.env.GMAIL_USER,
    to,
    subject: asunto,
    text: texto,
  });
}

module.exports = { enviarCorreoInterno };

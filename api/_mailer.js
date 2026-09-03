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

async function enviarCorreoInterno({ asunto, texto }) {
  await getTransporter().sendMail({
    from: process.env.GMAIL_USER,
    to: "info@qi-vanta.com",
    subject: asunto,
    text: texto,
  });
}

module.exports = { enviarCorreoInterno };

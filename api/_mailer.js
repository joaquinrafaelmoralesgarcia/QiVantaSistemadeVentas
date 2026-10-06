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
async function enviarCorreoInterno({ asunto, texto, to = "joaquin.morales@qi-vanta.com" }) {
  await getTransporter().sendMail({
    from: process.env.GMAIL_USER,
    to,
    subject: asunto,
    text: texto,
  });
}

module.exports = { enviarCorreoInterno };

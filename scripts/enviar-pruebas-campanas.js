// Envía únicamente tres vistas previas a un destinatario autorizado.
// No añade leads ni modifica campañas de Smartlead.
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");
const { ImapFlow } = require("imapflow");

const envPath = path.join(__dirname, "..", ".env.local");
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}

const destino = "joaquin.morales@qi-vanta.com";
const pruebas = [
  {
    asunto: "[PRUEBA — Google Maps] ¿Cuántas citas se pierden fuera de horario?",
    html: `<p>En negocios como el tuyo suele pasar que las llamadas y mensajes que llegan fuera de horario se quedan sin atender, y esas oportunidades terminan en otra opción.</p><p>En Qi-Vanta automatizamos la atención para responder llamadas con voz natural de IA y agendar citas automáticamente, incluso las 24 horas.</p><p>También desarrollamos apps móviles y sitios web a la medida para tu negocio.</p><p>Míralo funcionando en 30 segundos: <a href="https://negocios.qi-vanta.com/videos/qi-vanta-cita.mp4">https://negocios.qi-vanta.com/videos/qi-vanta-cita.mp4</a></p><p><strong>Te hacemos un diagnóstico gratis de tu negocio, con un resultado concreto en 48 horas.</strong></p><p>También puedes ver el resto de nuestras soluciones de IA aquí: <a href="https://negocios.qi-vanta.com/enterprise/">https://negocios.qi-vanta.com/enterprise/</a></p><p>Conoce más en <a href="https://negocios.qi-vanta.com">negocios.qi-vanta.com</a></p><p><strong>Si no reducimos costo y tiempo en tu operación, te regresamos tu dinero.</strong></p>`,
  },
  {
    asunto: "[PRUEBA — Piloto LATAM] Crecer sin duplicar la carga operativa",
    html: `<p>Hola, [Nombre]:</p><p>En empresas como [Empresa] suele haber procesos que absorben tiempo operativo, generan retrabajo y hacen más difícil escalar sin incrementar costos.</p><p>Qi-Vanta diseña automatizaciones y soluciones de IA para reducir esa carga: desde procesos internos e integraciones, hasta analítica, agentes de IA y modernización de aplicaciones.</p><p>También desarrollamos aplicaciones móviles a la medida para tu operación.</p><p>Míralo funcionando en 30 segundos: <a href="https://negocios.qi-vanta.com/videos/qi-vanta-escala.mp4">https://negocios.qi-vanta.com/videos/qi-vanta-escala.mp4</a></p><p><strong>Te hacemos un diagnóstico gratis de tu negocio, con un resultado concreto en 48 horas.</strong></p><p>Conoce más en <a href="https://www.qi-vanta.com">qi-vanta.com</a></p><p><strong>Si no reducimos costo y tiempo en tu operación, te regresamos tu dinero.</strong></p>`,
  },
  {
    asunto: "[PRUEBA — Alianzas] Hagamos una Alianza que no compite con tu negocio con Qi-Vanta",
    html: `<p>Hola,</p><p>Somos Qi-Vanta.</p><p>Estamos buscando generar alianzas con empresas de tecnología que ya atienden clientes empresariales y que están recibiendo solicitudes relacionadas con Inteligencia Artificial, automatización, agentes de IA o modernización tecnológica, pero cuyo foco principal está en otras especialidades.</p><p><strong>Ustedes mantienen la relación y propiedad comercial con su cliente, y Qi-Vanta entra como partner tecnológico especializado cuando necesiten capacidades de IA.</strong></p><p>Podemos trabajar bajo su marca, como partner visible o mediante un esquema de colaboración/comisión, dependiendo de cada oportunidad.</p><p>Puedes ver el detalle de estos servicios aquí: <a href="https://negocios.qi-vanta.com/enterprise/">https://negocios.qi-vanta.com/enterprise/</a></p><p>La idea no es competir por sus clientes, sino <strong>ampliar juntos el portafolio que pueden ofrecerles y generar nuevas oportunidades de negocio para ambas empresas</strong>.</p><p>¿Tendrías un espacio para explorar si existe posibilidad de colaboración?</p>`,
  },
];

async function main() {
  if (process.argv.includes("--verify") || process.argv.includes("--list")) {
    const client = new ImapFlow({
      host: "imap.gmail.com", port: 993, secure: true,
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }, logger: false,
    });
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const messages = [];
      for await (const message of client.fetch({ subject: "[PRUEBA —" }, { envelope: true, internalDate: true })) {
        if (message.envelope?.subject?.startsWith("[PRUEBA —")) {
          messages.push({ subject: message.envelope.subject, messageId: message.envelope.messageId, date: message.internalDate?.toISOString() });
        }
      }
      console.log(`Pruebas encontradas en INBOX: ${messages.length}`);
      if (process.argv.includes("--list")) console.log(JSON.stringify(messages, null, 2));
    } finally {
      lock.release();
      await client.logout();
    }
    return;
  }
  if (!process.argv.includes("--apply")) {
    console.log(`Simulación: se enviarían ${pruebas.length} pruebas a ${destino}. Usa --apply para enviarlas.`);
    return;
  }
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
  for (const prueba of pruebas) {
    const info = await transporter.sendMail({ from: process.env.GMAIL_USER, to: destino, subject: prueba.asunto, html: prueba.html });
    console.log(`Enviada: ${prueba.asunto} (${info.messageId})`);
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });

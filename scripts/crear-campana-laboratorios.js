// Crea la campaña de Laboratorios como borrador: sin leads, cuentas ni envíos.
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

const envPath = path.join(__dirname, "..", ".env.local");
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}

const nombre = "Qi-Vanta | Laboratorios";
const video = "https://negocios.qi-vanta.com/videos/qi-vanta-salud.mp4";
const secuencias = [
  {
    seq_number: 1,
    seq_delay_details: { delay_in_days: 0 },
    subject: "Procesos que quitan tiempo al laboratorio",
    email_body: `<p>Hola {{first_name}},</p><p>En laboratorios como {{company_name}} hay procesos que consumen mucho tiempo del equipo: atención de llamadas y mensajes, confirmaciones, seguimiento de pacientes, entrega de información y coordinación interna.</p><p>Qi-Vanta implementa automatización e inteligencia artificial para que esas tareas operativas se atiendan de forma consistente, mientras el equipo se concentra en el servicio y la operación clínica.</p><p>Podemos apoyar con asistentes de IA, automatización de procesos, integraciones con sistemas internos, aplicaciones móviles y herramientas para agilizar la atención.</p><p>Míralo funcionando en 30 segundos: <a href="${video}">${video}</a></p><p><strong>Te hacemos un diagnóstico gratis de tu operación, con un resultado concreto en 48 horas.</strong></p><p>Conoce más en <a href="https://negocios.qi-vanta.com/enterprise/">https://negocios.qi-vanta.com/enterprise/</a></p><p><strong>Si no reducimos costo y tiempo en tu operación, te regresamos tu dinero.</strong></p>`,
  },
  {
    seq_number: 2,
    seq_delay_details: { delay_in_days: 7 },
    subject: "¿Dónde se va el tiempo de tu equipo?",
    email_body: `<p>Hola {{first_name}},</p><p>Te escribí porque en muchos laboratorios las tareas repetitivas de atención, seguimiento y coordinación terminan restando tiempo a la operación.</p><p>Podemos revisar contigo qué proceso tendría mayor impacto al automatizarse, sin compromiso.</p><p><strong>Te hacemos un diagnóstico gratis de tu operación, con un resultado concreto en 48 horas.</strong></p>`,
  },
  {
    seq_number: 3,
    seq_delay_details: { delay_in_days: 7 },
    subject: "Último mensaje sobre automatización para laboratorios",
    email_body: `<p>Hola {{first_name}},</p><p>Este es mi último mensaje por ahora.</p><p>Si en algún momento buscan reducir carga operativa en atención, seguimiento o procesos internos del laboratorio, con gusto revisamos un caso concreto.</p><p><strong>Te hacemos un diagnóstico gratis de tu operación, con un resultado concreto en 48 horas.</strong></p>`,
  },
];

async function api(method, route, body) {
  const separator = route.includes("?") ? "&" : "?";
  const response = await fetch(`https://server.smartlead.ai/api/v1${route}${separator}api_key=${encodeURIComponent(process.env.SMARTLEAD_API_KEY)}`, {
    method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Smartlead ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  if (process.argv.includes("--check")) {
    const response = await fetch(`https://server.smartlead.ai/api/v1/campaigns?api_key=${encodeURIComponent(process.env.SMARTLEAD_API_KEY)}`);
    const body = await response.text();
    console.log(`Smartlead HTTP ${response.status}: ${body.slice(0, 500)}`);
    return;
  }
  if (process.argv.includes("--status")) {
    const campaigns = [
      ["Google Maps", process.env.SMARTLEAD_CAMPAIGN_ID],
      ["Piloto LATAM", process.env.SMARTLEAD_CAMPAIGN_ID_LATAM],
      ["Alianzas", process.env.SMARTLEAD_CAMPAIGN_ID_ALIANZAS || "3990563"],
      ["Laboratorios", "4084702"],
    ];
    for (const [label, id] of campaigns) {
      const campaign = await api("GET", `/campaigns/${id}`);
      console.log(`${label}: ${JSON.stringify({ id, name: campaign.name, status: campaign.status, maxLeadsPerDay: campaign.max_leads_per_day, schedule: campaign.scheduler_cron_value || null, responseFields: Object.keys(campaign).filter((key) => key.toLowerCase().includes("account")) })}`);
    }
    const accounts = await api("GET", "/email-accounts/?offset=0&limit=100");
    const active = (Array.isArray(accounts) ? accounts : []).filter((account) => account.is_smtp_success);
    console.log(`Cuentas SMTP sanas: ${active.length}`);
    return;
  }
  if (process.argv.includes("--metrics")) {
    const id = process.argv.includes("--metrics-latam") ? process.env.SMARTLEAD_CAMPAIGN_ID_LATAM : process.env.SMARTLEAD_CAMPAIGN_ID;
    const today = new Date().toISOString().slice(0, 10);
    const [todayData, analytics] = await Promise.all([
      api("GET", `/campaigns/${id}/analytics-by-date?start_date=${today}&end_date=${today}`),
      api("GET", `/campaigns/${id}/analytics`),
    ]);
    console.log(JSON.stringify({ campaignId: id, today, todayData, campaignLeadStats: analytics.campaign_lead_stats || {}, sentHistoric: analytics.sent_count || 0 }, null, 2));
    return;
  }
  if (process.argv.includes("--start-google-maps")) {
    const id = process.env.SMARTLEAD_CAMPAIGN_ID;
    const result = await api("POST", `/campaigns/${id}/status`, { status: "START" });
    console.log(JSON.stringify({ campaign: "Google Maps", id, requestedStatus: "START", result }));
    return;
  }
  if (process.argv.includes("--pause-google-maps")) {
    const id = process.env.SMARTLEAD_CAMPAIGN_ID;
    const result = await api("POST", `/campaigns/${id}/status`, { status: "PAUSED" });
    console.log(JSON.stringify({ campaign: "Google Maps", id, requestedStatus: "PAUSED", result }));
    return;
  }
  if (process.argv.includes("--send-preview")) {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });
    const primerCorreo = secuencias[0];
    const info = await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: "joaquin.morales@qi-vanta.com",
      subject: `[PRUEBA — Laboratorios] ${primerCorreo.subject}`,
      html: primerCorreo.email_body
        .replaceAll("{{first_name}}", "Joaquín")
        .replaceAll("{{company_name}}", "Laboratorio de ejemplo"),
    });
    console.log(`Vista previa enviada (${info.messageId})`);
    return;
  }
  if (!process.argv.includes("--apply")) {
    console.log(`Simulación: se crearía el borrador \"${nombre}\" con ${secuencias.length} pasos, sin leads ni cuentas de envío.`);
    return;
  }
  const campaign = await api("POST", "/campaigns/create", { name: nombre, client_id: null });
  if (!campaign.id) throw new Error("Smartlead no devolvió el ID de la campaña.");
  await api("POST", `/campaigns/${campaign.id}/sequences`, { sequences: secuencias });
  console.log(JSON.stringify({ campaignId: campaign.id, nombre, status: "borrador sin leads ni cuentas" }));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });

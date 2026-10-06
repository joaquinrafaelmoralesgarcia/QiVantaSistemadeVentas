// Prioriza Piloto LATAM y Alianzas sobre Google Maps usando todas las cuentas
// SMTP sanas: 40 correos/día por cuenta, 200 para Piloto y 120 para Alianzas.
const fs = require("fs");
const path = require("path");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}
const apply = process.argv.includes("--apply");
const key = process.env.SMARTLEAD_API_KEY;
const base = "https://server.smartlead.ai/api/v1";
const planes = [
  { nombre: "Piloto LATAM", id: process.env.SMARTLEAD_CAMPAIGN_ID_LATAM, tope: 200 },
  { nombre: "Alianzas", id: process.env.SMARTLEAD_CAMPAIGN_ID_ALIANZAS || "3990563", tope: 120 },
];

async function api(method, route, body) {
  const separator = route.includes("?") ? "&" : "?";
  const response = await fetch(`${base}${route}${separator}api_key=${encodeURIComponent(key)}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${route}: ${response.status} ${JSON.stringify(data)}`);
  return data;
}

(async () => {
  const cuentas = await api("GET", "/email-accounts/?offset=0&limit=100");
  const sanas = (Array.isArray(cuentas) ? cuentas : []).filter((c) => c.is_smtp_success);
  const ids = sanas.map((c) => c.id);
  console.log(JSON.stringify({ apply, cuentasSanas: sanas.map((c) => ({ id: c.id, correo: c.from_email, topeActual: c.message_per_day })) }, null, 2));
  if (!ids.length) throw new Error("No hay cuentas SMTP sanas.");
  if (!apply) return;

  for (const cuenta of sanas) await api("POST", `/email-accounts/${cuenta.id}`, { max_email_per_day: 40 });
  for (const plan of planes) {
    const actual = await api("GET", `/campaigns/${plan.id}`);
    const horario = actual.scheduler_cron_value || {};
    await api("POST", `/campaigns/${plan.id}/email-accounts`, { email_account_ids: ids });
    await api("POST", `/campaigns/${plan.id}/schedule`, {
      timezone: horario.tz || "America/Mexico_City",
      days_of_the_week: horario.days || [1, 2, 3, 4, 5],
      start_hour: horario.startHour || "08:00",
      end_hour: horario.endHour || "19:00",
      min_time_btw_emails: 3,
      max_new_leads_per_day: plan.tope,
    });
    await api("POST", `/campaigns/${plan.id}/status`, { status: "START" });
  }
  // Google Maps queda en pausa para reservar los 320 envíos diarios de las
  // ocho cuentas para las dos campañas prioritarias.
  await api("POST", `/campaigns/${process.env.SMARTLEAD_CAMPAIGN_ID}/status`, { status: "PAUSED" });
  console.log(JSON.stringify({ listo: true, cuentas: ids.length, capacidadDiaria: ids.length * 40, reparto: { piloto_latam: 200, alianzas: 120 }, googleMaps: "PAUSED" }));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });

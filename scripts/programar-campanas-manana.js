// Programa únicamente las campañas que reciben leads de la ventana actual:
// Google Maps (Apify) y Piloto LATAM (Apollo). Al activarlas fuera de su
// horario, Smartlead espera a las 08:00 America/Mexico_City para enviar.
const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}

const key = process.env.SMARTLEAD_API_KEY;
if (!key) throw new Error("Falta SMARTLEAD_API_KEY.");
const base = "https://server.smartlead.ai/api/v1";
const dry = process.argv.includes("--dry");
const cadenciaRapida = process.argv.includes("--cadencia-rapida");
const campanas = [
  { nombre: "Google Maps", id: process.env.SMARTLEAD_CAMPAIGN_ID },
  { nombre: "Piloto LATAM", id: process.env.SMARTLEAD_CAMPAIGN_ID_LATAM },
  { nombre: "Alianzas", id: process.env.SMARTLEAD_CAMPAIGN_ID_ALIANZAS || "3990563" },
].filter((campana) => campana.id);

async function api(method, route, body) {
  const separador = route.includes("?") ? "&" : "?";
  const response = await fetch(`${base}${route}${separador}api_key=${encodeURIComponent(key)}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${route}: ${response.status} ${JSON.stringify(data)}`);
  return data;
}

(async () => {
  for (const campana of campanas) {
    const actual = await api("GET", `/campaigns/${campana.id}`);
    const horario = actual.scheduler_cron_value || {};
    const nuevoHorario = {
      timezone: horario.tz || "America/Mexico_City",
      days_of_the_week: horario.days || [1, 2, 3, 4, 5],
      start_hour: "08:00",
      end_hour: horario.endHour || "19:00",
      min_time_btw_emails: cadenciaRapida ? 3 : (actual.min_time_btwn_emails || 4),
      max_new_leads_per_day: actual.max_leads_per_day || 1,
    };
    console.log(JSON.stringify({ campana: campana.nombre, id: campana.id, estadoActual: actual.status, horarioNuevo: nuevoHorario, accion: dry ? "simulacion" : "programar_y_activar" }));
    if (dry) continue;
    await api("POST", `/campaigns/${campana.id}/schedule`, nuevoHorario);
    await api("POST", `/campaigns/${campana.id}/status`, { status: "START" });
  }
})().catch((err) => { console.error(err.message); process.exitCode = 1; });

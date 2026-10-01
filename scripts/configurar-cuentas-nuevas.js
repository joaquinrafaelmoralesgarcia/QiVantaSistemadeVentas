// Configura los buzones nuevos de SmartSenders (comprados el 2026-10-01,
// 10 buzones Outlook en 4 dominios nuevos) para dejarlos listos igual que
// estaban las cuentas de Google: firma, warmup, tope de envio bajo y
// asignacion a las 3 campanas.
//
// Detecta las cuentas nuevas por exclusion: cualquiera cuyo dominio NO sea
// qi-vanta.com ni qi-vantatech.com (los 2 dominios viejos). Por defecto
// corre en SECO (solo muestra que haria); con --apply ejecuta.
//
//   node scripts/configurar-cuentas-nuevas.js           # simulacion
//   node scripts/configurar-cuentas-nuevas.js --apply   # ejecuta
const fs = require("fs");
const path = require("path");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const APPLY = process.argv.includes("--apply");
const KEY = process.env.SMARTLEAD_API_KEY;
const BASE = "https://server.smartlead.ai/api/v1";

const DOMINIOS_VIEJOS = ["qi-vanta.com", "qi-vantatech.com"];

// Tope inicial BAJO a proposito: son dominios y buzones nuevos, sin
// reputacion. Mandar 40/dia desde el dia 1 es justo lo que las deja en
// spam. Se sube poco a poco (ver plan de warmup acordado con el usuario).
const TOPE_INICIAL_POR_DIA = 5; // = dia 0 de scripts/rampa-envios.js, que lo sube solo hasta 40

// Firma de siempre (la de las cuentas de Google), con UN cambio: el correo
// de contacto ya no es joaquin.morales@qi-vantatech.com (dominio que se
// abandona) sino joaquin.morales@qi-vanta.com.
const FIRMA = `<div><img src="https://assets.smartlead.ai/user/635183/619f17f6-b9e6-4528-9c6a-2cb6fa2f6494/Logo.png" style="width: 251px; display: block; vertical-align: top; margin: 5px auto 5px 0px; text-align: left; border-style: none; cursor: pointer; padding: 0px 1px; user-select: none; max-width: unset; position: relative" fr-original-class="fr-draggable">Joaquin Morales</div><div>Strategic Transformation Advisor | Qi-Vanta<br>AI-Native SDLC &amp; Automatización<br><a data-fr-linked="true" href="mailto:joaquin.morales@qi-vanta.com" style="overscroll-behavior: none">joaquin.morales@qi-vanta.com</a><br><a href="https://www.qi-vanta.com">www.qi-vanta.com</a> · <a href="https://negocios.qi-vanta.com/enterprise/">Nuestros servicios</a></div><br>`;

const CAMPANIAS = {
  "Google Maps": process.env.SMARTLEAD_CAMPAIGN_ID,
  "Piloto LATAM": process.env.SMARTLEAD_CAMPAIGN_ID_LATAM,
  Alianzas: "3990563",
};

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

(async () => {
  const lista = await api("GET", "/email-accounts/?offset=0&limit=100");
  const nuevas = (Array.isArray(lista.json) ? lista.json : []).filter((a) => {
    const dominio = (a.from_email || "").split("@")[1] || "";
    return !DOMINIOS_VIEJOS.includes(dominio.toLowerCase());
  });

  console.log(`${APPLY ? "EJECUTANDO" : "SIMULACION"} — cuentas nuevas detectadas: ${nuevas.length}`);
  if (!nuevas.length) {
    console.log("Todavia no aparece ninguna cuenta fuera de qi-vanta.com / qi-vantatech.com.");
    process.exit(0);
  }

  const ids = nuevas.map((a) => a.id);
  nuevas.forEach((a) => console.log(` - ${a.id} ${a.from_email} (smtp_ok: ${a.is_smtp_success})`));

  const sinSmtp = nuevas.filter((a) => !a.is_smtp_success);
  if (sinSmtp.length) console.log(`AVISO: ${sinSmtp.length} cuenta(s) con SMTP sin confirmar todavia — quiza siguen provisionandose.`);

  if (!APPLY) {
    console.log(`\nHaria, por cada cuenta: firma, warmup ON, tope ${TOPE_INICIAL_POR_DIA}/dia. Y asignar las ${ids.length} a las 3 campanas.`);
    process.exit(0);
  }

  for (const a of nuevas) {
    const f = await api("POST", `/email-accounts/${a.id}`, { signature: FIRMA, message_per_day: TOPE_INICIAL_POR_DIA });
    // Warmup propio de Smartlead (correos entre buzones, aparte de las campanas).
    // 35 como tope = el que ya usaban las cuentas de Google; rampa de +2/dia.
    let w = await api("POST", `/email-accounts/${a.id}/warmup`, { warmup_enabled: true, total_warmup_per_day: 35, daily_rampup: 2, reply_rate_percentage: 35 });
    if (!w.ok) w = await api("POST", `/email-accounts/${a.id}/warmup`, { warmup_enabled: true }); // respaldo: solo encender
    console.log(`${a.from_email}: firma/tope ${f.status}, warmup ${w.status}`);
  }

  for (const [nombre, id] of Object.entries(CAMPANIAS)) {
    const r = await api("POST", `/campaigns/${id}/email-accounts`, { email_account_ids: ids });
    console.log(`Campana ${nombre}: asignacion ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
  }
  console.log("LISTO");
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });

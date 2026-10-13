// Da de alta en Smartlead los buzones SMTP de Mailforge (comprados el
// 2026-10-12: 10 buzones en 5 dominios .com) y los deja en WARMUP, sin
// asignarlos a ninguna campana.
//
// POR QUE: los buzones de SmartSenders (Microsoft 365) fueron bloqueados por
// Microsoft (5.1.8 bad outbound sender, ver canario-entrega.js). Estos son
// SMTP propio de Mailforge: no dependen de un tenant de Microsoft. Smartlead
// recomienda ~14 dias de warmup antes de usarlos en campanas vivas, y luego
// 10-15 correos/dia por buzon subiendo poco a poco. Por eso este script NO
// los asigna a campanas: eso se hace a mano (o con asignar-buzones-mailforge)
// pasados los 14 dias y con el canario en verde.
//
// Entrada: el CSV que exporta Mailforge (Mailboxes -> Export -> Export to
// other -> Smartlead). Se espera en
//   C:\Users\Joaquin\Downloads\Apis\mailforge-buzones.csv
// o en la ruta que se pase como primer argumento. El CSV lleva contrasenas:
// NO se copia al repo ni se imprime nada de el.
//
//   node scripts/alta-buzones-mailforge.js            # simulacion
//   node scripts/alta-buzones-mailforge.js --apply    # ejecuta
const fs = require("fs");
const path = require("path");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const APPLY = process.argv.includes("--apply");
const ARCHIVO = process.argv.find((a, i) => i >= 2 && !a.startsWith("--")) || (fs.existsSync("C:/Users/Joaquin/Downloads/Apis/mailforge-buzones.csv") ? "C:/Users/Joaquin/Downloads/Apis/mailforge-buzones.csv" : "C:/Users/Joaquin/Downloads/Mailbox_list_12_Oct_2026.csv");
const KEY = process.env.SMARTLEAD_API_KEY;
const BASE = "https://server.smartlead.ai/api/v1";

// Tope de envio inicial BAJO a proposito (dominios nuevos, sin reputacion).
// scripts/rampa-envios.js lo sube solo con el calendario de 28 dias.
const TOPE_INICIAL_POR_DIA = 5;
// Warmup conservador y creciente. El warmup corre TODO el tiempo, tambien
// cuando ya envien campanas.
const WARMUP = { warmup_enabled: true, total_warmup_per_day: 40, daily_rampup: 5, /* Smartlead exige >= 5 */ reply_rate_percentage: 40 };

// Misma firma que el resto de buzones (la de configurar-cuentas-nuevas.js).
const fuenteFirma = fs.readFileSync(path.join(__dirname, "configurar-cuentas-nuevas.js"), "utf8");
const FIRMA = (fuenteFirma.match(/const FIRMA = `([\s\S]*?)`;/) || [])[1] || "";

function parseCsv(texto) {
  const filas = [];
  let fila = [], campo = "", comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ",") { fila.push(campo); campo = ""; }
    else if (c === "\n") { fila.push(campo.replace(/\r$/, "")); filas.push(fila); fila = []; campo = ""; }
    else campo += c;
  }
  if (campo || fila.length) { fila.push(campo.replace(/\r$/, "")); filas.push(fila); }
  const [cab, ...datos] = filas.filter((f) => f.some((x) => x.trim()));
  const claves = cab.map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"));
  return datos.map((f) => Object.fromEntries(claves.map((k, i) => [k, (f[i] || "").trim()])));
}

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
  if (!fs.existsSync(ARCHIVO)) {
    console.error(`No existe ${ARCHIVO}. Exporta los buzones desde Mailforge (Mailboxes -> Export -> Smartlead).`);
    process.exitCode = 1;
    return;
  }
  const filas = parseCsv(fs.readFileSync(ARCHIVO, "utf8"));
  const existentes = await api("GET", "/email-accounts/?offset=0&limit=100");
  const yaEstan = new Set((Array.isArray(existentes.json) ? existentes.json : []).map((a) => (a.from_email || "").toLowerCase()));
  console.log(`${APPLY ? "EJECUTANDO" : "SIMULACION"} — ${filas.length} buzones en el CSV`);

  for (const f of filas) {
    const correo = (f.from_email || f.email || f.user_name || "").toLowerCase();
    const faltan = ["password", "smtp_host", "smtp_port", "imap_host", "imap_port"].filter((k) => !f[k]);
    if (!correo || faltan.length) { console.log(`  OMITIDO ${correo || "(sin correo)"}: faltan columnas ${faltan.join(", ")}`); continue; }
    if (yaEstan.has(correo)) { console.log(`  YA EXISTE ${correo}`); continue; }
    const cuerpo = {
      id: null,
      from_name: f.from_name || [f.first_name, f.last_name].filter(Boolean).join(" ") || correo.split("@")[0],
      from_email: correo,
      user_name: f.user_name || correo,
      password: f.password,
      smtp_host: f.smtp_host,
      smtp_port: Number(f.smtp_port),
      imap_host: f.imap_host,
      imap_port: Number(f.imap_port),
      ...(f.imap_user_name ? { imap_user_name: f.imap_user_name } : {}),
      ...(f.imap_password ? { imap_password: f.imap_password } : {}),
      max_email_per_day: TOPE_INICIAL_POR_DIA,
      custom_tracking_url: f.custom_tracking_url || "",
      bcc: "",
      signature: FIRMA,
      ...WARMUP,
    };
    console.log(`  ${APPLY ? "ALTA" : "ALTA (simulada)"} ${correo} — tope ${TOPE_INICIAL_POR_DIA}/dia, warmup ${WARMUP.total_warmup_per_day}/dia (+${WARMUP.daily_rampup}), sin campanas`);
    if (!APPLY) continue;
    const r = await api("POST", "/email-accounts/save", cuerpo);
    if (!r.ok || r.json?.ok === false) { console.log(`    ERROR ${r.status}: ${JSON.stringify(r.json).replace(/"password":"[^"]*"/g, '"password":"<oculto>"').slice(0, 200)}`); continue; }
    const id = r.json.emailAccountId || r.json.id;
    if (id) {
      const w = await api("POST", `/email-accounts/${id}/warmup`, WARMUP);
      console.log(`    ok id ${id}; warmup ${w.ok ? "activado" : "ERROR " + w.status}`);
    }
  }
})().catch((e) => { console.error(e.message); process.exitCode = 1; });

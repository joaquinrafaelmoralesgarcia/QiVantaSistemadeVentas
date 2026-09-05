// Monitor diario de las campañas de Smartlead — pedido del usuario el
// 2026-09-05 tras descubrir que Piloto LATAM llevaba desde el 2 de
// septiembre bloqueada en estado "COMPLETED" (se completa sola cuando se
// acaba la secuencia — nunca es algo que el usuario decide a propósito) sin
// que nadie lo notara hasta revisar la UI de Smartlead manualmente.
//
// Corre cada mañana ANTES de la ventana de envío (8:00-10:00am CDMX) vía
// GitHub Actions. Si encuentra una campaña en "COMPLETED", la reactiva sola
// (ese estado nunca es una decisión intencional del usuario, siempre es
// consecuencia de que se acabó la secuencia). Si la encuentra "PAUSED", NO
// la toca — esa sí puede ser una pausa intencional (ej. el incidente de
// saldo de Anthropic de esta misma campaña en el pasado) y un sistema
// automático no debe decidir revertirla — solo avisa por correo.
const { enviarCorreoInterno } = require("./_mailer");

const SMARTLEAD_BASE_URL = "https://server.smartlead.ai/api/v1";

const CAMPANAS_A_VIGILAR = [
  { id: "3890342", nombre: "Qi-Vanta | Apify Google Maps" },
  { id: "3842244", nombre: "Qi-Vanta | Piloto LATAM | Decisores" },
];

async function obtenerCampania(id) {
  const apiKey = process.env.SMARTLEAD_API_KEY;
  const res = await fetch(`${SMARTLEAD_BASE_URL}/campaigns/${id}?api_key=${encodeURIComponent(apiKey)}`);
  if (!res.ok) throw new Error(`No se pudo consultar la campaña ${id} (${res.status})`);
  return res.json();
}

async function reactivarCampania(id) {
  const apiKey = process.env.SMARTLEAD_API_KEY;
  const res = await fetch(`${SMARTLEAD_BASE_URL}/campaigns/${id}/status?api_key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "START" }),
  });
  if (!res.ok) throw new Error(`No se pudo reactivar la campaña ${id} (${res.status})`);
}

module.exports = async function handler(req, res) {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: "No autorizado." });
    return;
  }

  const hallazgos = [];

  try {
    for (const campania of CAMPANAS_A_VIGILAR) {
      try {
        const datos = await obtenerCampania(campania.id);

        if (datos.status === "COMPLETED") {
          await reactivarCampania(campania.id);
          hallazgos.push(`"${campania.nombre}" estaba en COMPLETED (se acabó su secuencia) — la reactivé automáticamente.`);
        } else if (datos.status === "PAUSED") {
          hallazgos.push(`⚠️ "${campania.nombre}" está en PAUSED — NO la toqué (podría ser una pausa intencional tuya). Revísala si no la pausaste tú.`);
        }
        // ACTIVE/DRAFTED: sin novedad, no se reporta.
      } catch (err) {
        hallazgos.push(`Error revisando "${campania.nombre}": ${err.message}`);
      }
    }

    if (hallazgos.length && process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
      await enviarCorreoInterno({
        asunto: `Monitor de campañas Smartlead: ${hallazgos.length} hallazgo(s)`,
        texto: hallazgos.join("\n\n"),
      });
    }

    res.status(200).json({ ok: true, hallazgos });
  } catch (err) {
    console.error("Error en cron-monitor-campanas:", err);
    res.status(500).json({ error: err.message });
  }
};

// Status diario de ambas campañas para el panel admin — pedido explícito
// del usuario el 2026-09-10: "quiero que cada dia veamos status". Junta en
// una sola llamada lo que antes se consultaba a mano con scripts sueltos:
// envíos de hoy, totales de la campaña, y saldo de créditos de Apollo.
const SMARTLEAD_BASE_URL = "https://server.smartlead.ai/api/v1";

async function statusDeCampania(nombre, id, apiKey, hoy) {
  const [hoyData, analytics] = await Promise.all([
    fetch(`${SMARTLEAD_BASE_URL}/campaigns/${id}/analytics-by-date?api_key=${encodeURIComponent(apiKey)}&start_date=${hoy}&end_date=${hoy}`).then((r) => r.json()),
    fetch(`${SMARTLEAD_BASE_URL}/campaigns/${id}/analytics?api_key=${encodeURIComponent(apiKey)}`).then((r) => r.json()),
  ]);
  const stats = analytics.campaign_lead_stats || {};
  return {
    nombre,
    enviadosHoy: Number(hoyData.sent_count || 0),
    unicosHoy: Number(hoyData.unique_sent_count || 0),
    abiertosHoy: Number(hoyData.open_count || 0),
    respuestasHoy: Number(hoyData.reply_count || 0),
    rebotesHoy: Number(hoyData.bounce_count || 0),
    totalLeads: stats.total ?? null,
    sinEmpezar: stats.notStarted ?? null,
    enProceso: stats.inprogress ?? null,
    completados: stats.completed ?? null,
    interesados: stats.interested ?? null,
    bloqueados: stats.blocked ?? null,
    enviadosHistorico: Number(analytics.sent_count || 0),
    unicosHistorico: Number(analytics.unique_sent_count || 0),
    respuestasHistorico: Number(analytics.reply_count || 0),
    rebotesHistorico: Number(analytics.bounce_count || 0),
  };
}

async function obtenerStatusCampanas() {
  const apiKey = process.env.SMARTLEAD_API_KEY;
  const hoy = new Date().toISOString().slice(0, 10);

  const campanas = await Promise.all([
    statusDeCampania("Piloto LATAM", process.env.SMARTLEAD_CAMPAIGN_ID_LATAM, apiKey, hoy),
    statusDeCampania("Google Maps", process.env.SMARTLEAD_CAMPAIGN_ID, apiKey, hoy),
  ]);

  let apolloCreditos = null;
  try {
    const { obtenerCreditosLead } = require("./_apollo");
    apolloCreditos = await obtenerCreditosLead();
  } catch (err) {
    apolloCreditos = { error: err.message };
  }

  return { fecha: hoy, campanas, apolloCreditos, generadoEn: new Date() };
}

module.exports = { obtenerStatusCampanas };

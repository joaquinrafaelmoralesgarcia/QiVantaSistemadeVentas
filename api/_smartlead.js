// Agrega un lead a una campaña de Smartlead para que el correo frío salga
// rotando entre las 6 cuentas de workspace ya configuradas ahí. Usado por
// el flujo de Google Maps (_leadsProcessor.js, campaña por default
// SMARTLEAD_CAMPAIGN_ID = "Qi-Vanta | Apify Google Maps", id 3890342) y
// desde el 2026-09-07 también por el flujo de Piloto LATAM
// (_leadsProcessorEmpresa.js, pasando campaignId=SMARTLEAD_CAMPAIGN_ID_LATAM
// explícitamente).
// Verificado con la cuenta real el 2026-09-02: la secuencia de esa campaña
// usa los merge tags {{qi_vanta_subject}}/{{qi_vanta_message}} (y desde el
// 2026-09-05, {{qi_vanta_followup1}}/{{qi_vanta_followup2}} en los pasos 2
// y 3 de la secuencia) en vez de los campos estándar de Smartlead — hay
// que mandarlos como custom_fields con esos nombres exactos o el correo
// sale vacío.
const SMARTLEAD_BASE_URL = "https://server.smartlead.ai/api/v1";

async function agregarLeadACampania({ nombre, correo, empresa, telefono, customFields, campaignId }) {
  const apiKey = process.env.SMARTLEAD_API_KEY;
  const idCampania = campaignId || process.env.SMARTLEAD_CAMPAIGN_ID;

  if (!apiKey || !idCampania) {
    throw new Error("Falta configurar SMARTLEAD_API_KEY y/o SMARTLEAD_CAMPAIGN_ID.");
  }

  const url = `${SMARTLEAD_BASE_URL}/campaigns/${idCampania}/leads?api_key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lead_list: [
        {
          first_name: nombre || "",
          email: correo,
          company_name: empresa || "",
          phone_number: telefono || "",
          custom_fields: customFields || {},
        },
      ],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Smartlead respondió con error (${res.status}): ${errBody}`);
  }

  return res.json();
}

// Ajusta cuántos leads nuevos al día puede mandar una campaña — pedido
// explícito del usuario el 2026-09-09: "al acabarse los creditos de
// apollo, sube el nivel de envios de campaña de google maps... para
// llenar los 40 envios por cada cuenta de correo... cada vez que se me
// acaben los creditos de apollo". Las 6 cuentas son compartidas entre
// Google Maps y Piloto LATAM (6 × 40/día = 240 de cupo total); cuando
// Piloto LATAM no tiene nada nuevo que mandar ese día, Google Maps puede
// usar el cupo completo sin que se desperdicie.
//
// Verificado el 2026-09-09 contra la API real: el endpoint exige mandar
// TODOS los campos del horario juntos (no solo el que cambia), o
// responde 400 pidiendo el campo faltante uno por uno. Por eso primero
// se lee el horario actual y se reenvía completo, solo cambiando
// max_new_leads_per_day.
async function actualizarTopeCampania(campaignId, maxNuevosLeadsPorDia) {
  const apiKey = process.env.SMARTLEAD_API_KEY;
  const actual = await fetch(`${SMARTLEAD_BASE_URL}/campaigns/${campaignId}?api_key=${encodeURIComponent(apiKey)}`).then((r) => r.json());

  if (actual.max_leads_per_day === maxNuevosLeadsPorDia) {
    return { sinCambio: true, topeActual: actual.max_leads_per_day };
  }

  const horario = actual.scheduler_cron_value || {};
  const res = await fetch(`${SMARTLEAD_BASE_URL}/campaigns/${campaignId}/schedule?api_key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      timezone: horario.tz || "America/Mexico_City",
      days_of_the_week: horario.days || [1, 2, 3, 4, 5, 6],
      start_hour: horario.startHour || "08:00",
      end_hour: horario.endHour || "10:00",
      min_time_btw_emails: actual.min_time_btwn_emails || 4,
      max_new_leads_per_day: maxNuevosLeadsPorDia,
    }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`No se pudo actualizar el tope de la campaña ${campaignId} (${res.status}): ${errBody}`);
  }
  return { sinCambio: false, topeAnterior: actual.max_leads_per_day, topeNuevo: maxNuevosLeadsPorDia };
}

module.exports = { agregarLeadACampania, actualizarTopeCampania };

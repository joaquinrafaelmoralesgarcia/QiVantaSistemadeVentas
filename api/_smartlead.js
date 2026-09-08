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

module.exports = { agregarLeadACampania };

// Agrega un lead a una campaña de Smartlead para que el correo frío salga
// automáticamente rotando entre tus cuentas de workspace configuradas ahí.
// Verifica el campaign ID y el formato exacto del payload contra la
// documentación de tu cuenta (Smartlead → Campaign → API) antes del primer
// envío real; este endpoint sigue el patrón documentado públicamente
// (POST /api/v1/campaigns/{campaign_id}/leads con api_key como query param).
const SMARTLEAD_BASE_URL = "https://server.smartlead.ai/api/v1";

async function agregarLeadACampania({ nombre, correo, empresa, telefono, customFields }) {
  const apiKey = process.env.SMARTLEAD_API_KEY;
  const campaignId = process.env.SMARTLEAD_CAMPAIGN_ID;

  if (!apiKey || !campaignId) {
    throw new Error("Falta configurar SMARTLEAD_API_KEY y/o SMARTLEAD_CAMPAIGN_ID.");
  }

  const url = `${SMARTLEAD_BASE_URL}/campaigns/${campaignId}/leads?api_key=${encodeURIComponent(apiKey)}`;

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

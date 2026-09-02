// Agrega un lead a la campaña "Qi-Vanta | Piloto LATAM | Decisores" (id
// verificado: 3842244) para que el correo frío salga rotando entre las 6
// cuentas de workspace ya configuradas en Smartlead.
// Verificado con la cuenta real el 2026-09-02: la secuencia de esa campaña
// usa los merge tags {{qi_vanta_subject}} y {{qi_vanta_message}} en vez de
// los campos estándar de Smartlead — hay que mandarlos como custom_fields
// con esos nombres exactos (ver _leadScript.js) o el correo sale vacío.
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

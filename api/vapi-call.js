const VAPI_API_URL = "https://api.vapi.ai/call";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const vapiKey = process.env.VAPI_API_KEY;
  const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
  const assistantId = process.env.VAPI_ASSISTANT_ID;

  if (!vapiKey || !phoneNumberId || !assistantId) {
    res.status(500).json({
      error:
        "Falta configurar VAPI_API_KEY, VAPI_PHONE_NUMBER_ID y/o VAPI_ASSISTANT_ID en las variables de entorno del servidor.",
    });
    return;
  }

  try {
    const { phoneNumber } = req.body || {};

    if (!phoneNumber || typeof phoneNumber !== "string") {
      res.status(400).json({ error: "Falta el número de teléfono." });
      return;
    }

    // Normaliza a formato E.164 (MX). Casos que puede escribir el usuario:
    //   "7206442283"      -> 10 dígitos locales, sin código de país
    //   "527206442283"    -> 12 dígitos, ya trae el 52 pero sin "+"
    //   "+527206442283"   -> ya viene en E.164 completo
    let digits = phoneNumber.replace(/[^\d+]/g, "");
    let normalized;
    if (digits.startsWith("+")) {
      normalized = digits;
    } else if (digits.length === 10) {
      normalized = `+52${digits}`;
    } else if (digits.length === 12 && digits.startsWith("52")) {
      normalized = `+${digits}`;
    } else {
      normalized = `+52${digits}`;
    }

    if (!/^\+\d{11,15}$/.test(normalized)) {
      res.status(400).json({
        error: `El número "${phoneNumber}" no parece válido. Usa formato E.164, ej. +527206442283.`,
      });
      return;
    }

    const vapiRes = await fetch(VAPI_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${vapiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        phoneNumberId,
        customer: { number: normalized },
        assistantId,
      }),
    });

    const data = await vapiRes.json();

    if (!vapiRes.ok) {
      res.status(vapiRes.status).json({
        error: data.message || data.error || "Vapi rechazó la solicitud de llamada.",
      });
      return;
    }

    res.status(200).json({ callId: data.id, status: data.status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al iniciar la llamada con Vapi." });
  }
};

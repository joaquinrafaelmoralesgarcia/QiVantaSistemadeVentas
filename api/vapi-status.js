module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const vapiKey = process.env.VAPI_API_KEY;
  const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;

  if (!vapiKey) {
    res.status(500).json({ error: "Falta configurar VAPI_API_KEY en el servidor." });
    return;
  }

  const { callId } = req.query || {};

  try {
    let call;

    if (callId) {
      const vapiRes = await fetch(`https://api.vapi.ai/call/${callId}`, {
        headers: { Authorization: `Bearer ${vapiKey}` },
      });
      call = await vapiRes.json();
      if (!vapiRes.ok) {
        res.status(vapiRes.status).json({ error: call.message || "No se pudo consultar la llamada." });
        return;
      }
    } else {
      // Sin callId: buscar la llamada entrante más reciente a nuestro número
      if (!phoneNumberId) {
        res.status(500).json({ error: "Falta configurar VAPI_PHONE_NUMBER_ID en el servidor." });
        return;
      }
      const listRes = await fetch(
        `https://api.vapi.ai/call?phoneNumberId=${encodeURIComponent(phoneNumberId)}&limit=1`,
        { headers: { Authorization: `Bearer ${vapiKey}` } }
      );
      const list = await listRes.json();
      if (!listRes.ok) {
        res.status(listRes.status).json({ error: list.message || "No se pudo consultar las llamadas." });
        return;
      }
      call = Array.isArray(list) ? list[0] : list.results?.[0];
      if (!call) {
        res.status(200).json({ status: "sin_llamadas" });
        return;
      }
    }

    res.status(200).json({
      status: call.status, // queued | ringing | in-progress | ended
      endedReason: call.endedReason || null,
      transcript: call.transcript || null,
      summary: call.analysis?.summary || call.summary || null,
      messages: call.messages || call.artifact?.messages || [],
      startedAt: call.startedAt || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar el estado de la llamada." });
  }
};

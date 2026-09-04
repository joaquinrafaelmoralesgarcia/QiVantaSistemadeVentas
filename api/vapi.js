// Disparar (POST) y consultar (GET) llamadas de voz IA vía Vapi — consolidado
// en un solo archivo por el límite de 12 funciones serverless de Vercel Hobby.
// CORS abierto: se llama desde call-widget.js embebido en qi-vanta.com
// (origen distinto a este backend en Vercel) — pedido del usuario el
// 2026-09-04 para el botón "Llámame" del portal.
const { aplicarCors } = require("./_cors");
const { getDb } = require("./_mongo");

const VAPI_API_URL = "https://api.vapi.ai/call";
const COOLDOWN_MS = 10 * 60 * 1000; // 10 min entre solicitudes al mismo número

// Este endpoint queda expuesto sin login (lo llama call-widget.js desde
// visitantes anónimos del portal) — sin este freno, cualquiera podría
// spamear llamadas al mismo número una y otra vez, con costo real de
// Vapi/Twilio cada vez. También sirve de bitácora de quién pidió que le
// llamaran.
async function permitirLlamada(db, numero) {
  const coleccion = db.collection("vapi_llamadas");
  const reciente = await coleccion.findOne({ numero, creadoEn: { $gte: new Date(Date.now() - COOLDOWN_MS) } });
  if (reciente) return null;
  const { insertedId } = await coleccion.insertOne({ numero, creadoEn: new Date() });
  return insertedId;
}

async function iniciarLlamada(req, res) {
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

    const db = await getDb();
    const registroId = await permitirLlamada(db, normalized);
    if (!registroId) {
      res.status(429).json({ error: "Ya se solicitó una llamada a este número hace poco. Espera unos minutos e intenta de nuevo." });
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

    // Guarda el callId en el mismo doc de cooldown para que vapi-webhook.js
    // pueda ligar el resultado de la llamada (datos capturados, resumen)
    // cuando Vapi nos avise que terminó.
    if (data.id) {
      await db.collection("vapi_llamadas").updateOne({ _id: registroId }, { $set: { callId: data.id } });
    }

    res.status(200).json({ callId: data.id, status: data.status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al iniciar la llamada con Vapi." });
  }
}

async function consultarLlamada(req, res) {
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
}

module.exports = async function handler(req, res) {
  if (aplicarCors(req, res)) return;
  if (req.method === "POST") return iniciarLlamada(req, res);
  if (req.method === "GET") return consultarLlamada(req, res);
  res.status(405).json({ error: "Method not allowed" });
};

// Webhook de fin de llamada de Vapi — pedido del usuario el 2026-09-04: los
// datos que el asistente de voz le pide al cliente durante la llamada
// (nombre, empresa, correo, teléfono, número de empleados, sector, reto)
// también deben llegar por correo, igual que los del chat web.
//
// Configurado en el asistente de Vapi vía PATCH /assistant/{id}:
// server.url -> este endpoint, serverMessages: ["end-of-call-report"],
// analysisPlan.structuredDataPlan (schema con esos 7 campos) y
// analysisPlan.summaryPlan.enabled:true. Nota: analysisPlan está marcado
// "deprecated" en el spec actual de Vapi pero sigue siendo funcional (así
// venía ya configurado parcialmente en el asistente antes de este cambio).
const { enviarCorreoInterno } = require("./_mailer");
const { getDb } = require("./_mongo");

// Motivos de Vapi que significan "nunca contestó" (no una conversación
// real) — confirmado contra la documentación de Vapi el 2026-09-11.
// Cualquier otro motivo (customer-ended-call, etc.) significa que sí hubo
// conversación real, aunque haya sido corta o negativa.
const SIN_CONTESTAR = new Set(["customer-did-not-answer", "customer-busy", "voicemail"]);

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (process.env.VAPI_WEBHOOK_SECRET && req.headers["x-vapi-webhook-secret"] !== process.env.VAPI_WEBHOOK_SECRET) {
    res.status(401).json({ error: "No autorizado." });
    return;
  }

  const message = req.body?.message;
  if (!message || message.type !== "end-of-call-report") {
    // Otros tipos de evento (si algún día se agregan más a serverMessages) — se ignoran.
    res.status(200).json({ ok: true, ignorado: true });
    return;
  }

  try {
    const numero = message.customer?.number || "desconocido";
    const analysis = message.analysis || {};
    const datos = analysis.structuredData || {};
    const resumen = analysis.summary || "(sin resumen)";
    const transcripcion = message.artifact?.transcript || "(sin transcripción)";
    const callId = message.call?.id || null;

    const db = await getDb();
    if (callId) {
      await db
        .collection("vapi_llamadas")
        .updateOne({ callId }, { $set: { resultado: { datos, resumen, endedReason: message.endedReason || null, terminadaEn: new Date() } } });
    }

    // Registro de llamadas en frío — pedido explícito del usuario el
    // 2026-09-11, simplificado el mismo día ("hagamos solo un intento ya
    // que el costo es mucho"): un solo intento por número, contestado o
    // no, nunca se vuelve a marcar. Se guarda por teléfono (no por lead
    // individual) porque es lo único estable si algún día se retoma. El
    // script de marcado por lotes debe filtrar por estado="pendiente"
    // (o sin documento) antes de marcar.
    if (numero && numero !== "desconocido") {
      const ahora = new Date();
      const contestada = Boolean(callId) && !SIN_CONTESTAR.has(message.endedReason);
      const intento = { fecha: ahora, diaSemana: ahora.getDay(), endedReason: message.endedReason || null, contestada, callId };

      const existente = await db.collection("llamadasFrio").findOne({ telefono: numero });

      await db.collection("llamadasFrio").updateOne(
        { telefono: numero },
        {
          $push: { intentos: intento },
          $set: {
            estado: contestada ? "contestada" : "no_contestada",
            actualizadoEn: ahora,
            nombreNegocio: message.call?.metadata?.nombreNegocio || existente?.nombreNegocio || null,
            ubicacionGoogleMaps: message.call?.metadata?.ubicacionGoogleMaps || existente?.ubicacionGoogleMaps || null,
          },
        },
        { upsert: true }
      );
    }

    // Guarda leads interesados en cita/llamada/sesión de las llamadas en
    // frío (Google Maps) — pedido explícito del usuario el 2026-09-11.
    // nombreNegocio/ubicacionGoogleMaps NO se preguntan en la llamada (ya
    // los sabemos, son el lead al que llamamos) — viajan en message.call.
    // metadata, puesto ahí al iniciar la llamada (ver script de marcado
    // por lotes). El resto (nombrePersona, correo) sí sale de la
    // conversación real (analysis.structuredData).
    const metadataLlamada = message.call?.metadata || {};
    const interesado = Boolean(
      datos.citaAcordada || /^alto$|^medio$/i.test(datos.interes || "")
    );
    if (interesado && (metadataLlamada.nombreNegocio || datos.correo || datos.nombre)) {
      await db.collection("vapi_interesados").insertOne({
        nombreNegocio: metadataLlamada.nombreNegocio || null,
        ubicacionGoogleMaps: metadataLlamada.ubicacionGoogleMaps || null,
        nombrePersona: datos.nombre || null,
        telefono: numero,
        correo: datos.correo || null,
        interes: datos.interes || null,
        citaAcordada: datos.citaAcordada || null,
        retoOOportunidad: datos.retoOOportunidad || null,
        resumen,
        callId,
        createdAt: new Date(),
      });
    }

    // Correo interno solo si hay interés real — pedido explícito del
    // usuario el 2026-09-11: "esta bien que me llegue al correo info...
    // pero solo de clientes interesados o que requieran sesion o cita".
    // Antes se mandaba por cada llamada sin excepción; con el volumen de
    // llamadas en frío eso saturaría la bandeja con puros "no, gracias".
    if (interesado && process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
      await enviarCorreoInterno({
        asunto: `Nueva llamada del botón "Llámame": ${datos.nombre || numero}${datos.empresa ? " (" + datos.empresa + ")" : ""}`,
        texto: [
          `Teléfono: ${numero}`,
          `Nombre: ${datos.nombre || "(no capturado)"}`,
          `Empresa: ${datos.empresa || "(no capturado)"}`,
          `Correo: ${datos.correo || "(no capturado)"}`,
          `Número de empleados: ${datos.numEmpleados || "(no capturado)"}`,
          `Sector: ${datos.sector || "(no capturado)"}`,
          `Reto/necesidad: ${datos.reto || "(no capturado)"}`,
          "",
          `Resumen de la llamada: ${resumen}`,
          "",
          "--- Transcripción completa ---",
          "",
          transcripcion,
        ].join("\n"),
      });
    } else if (interesado) {
      console.error("Falta configurar GMAIL_USER/GMAIL_APP_PASSWORD — no se envió correo de la llamada interesada.");
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Error procesando end-of-call-report de Vapi:", err);
    res.status(200).json({ ok: false, error: err.message });
  }
};

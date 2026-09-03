// Webhook de WhatsApp vía WATI.
//
// IMPORTANTE — pendiente de verificar con una cuenta real de WATI:
//   1) El nombre exacto de los campos que WATI manda en el webhook de "mensaje
//      entrante" puede variar por versión de cuenta. Este handler intenta varias
//      variantes conocidas (waId/whatsappNumber, text/data.text, type/eventType),
//      pero si no llega nada útil, revisa los logs de Vercel: se imprime el body
//      crudo con console.log para poder ajustar el mapeo exacto.
//   2) WATI_API_ENDPOINT es la URL base de TU cuenta (aparece en el panel de WATI,
//      sección API Docs) — típicamente algo como
//      https://live-mt-server.wati.io/<tenantId> o https://live-server-XXXX.wati.io/<tenantId>.
//      No es la misma para todas las cuentas, así que debe configurarse por env var.
//   3) detectarTomaDeControlHumano() abajo intenta detectar cuándo TÚ (no el
//      bot) le contestaste a un cliente desde el dashboard de WATI, usando
//      los campos más comunes de WATI para esto (operatorName/operatorEmail/
//      assignedName). PENDIENTE DE VERIFICAR con un envío real tuyo desde el
//      dashboard — si no pausa el bot correctamente la primera vez, revisa
//      el log crudo del webhook para ver qué campo sí trae tu nombre/correo
//      y ajusta la función.
const { chatCompletionText } = require("./_deepinfraClient");
const { getDb } = require("./_mongo");
const { SYSTEM_PROMPT, PLAIN_TEXT_FORMAT_SUFFIX } = require("./_systemPrompt");
const { enviarRespuestaWati } = require("./_watiSend");
const MAX_HISTORY = 16;

function extraerMensajeEntrante(body) {
  // WATI puede mandar el payload plano o envuelto en "data" según el evento.
  const d = body?.data || body || {};

  const waId = d.waId || d.whatsappNumber || d.phone || body?.waId;
  const texto = d.text || d.messageText || d.body || body?.text;
  const tipo = d.type || d.eventType || body?.eventType || "";
  const nombre = d.senderName || d.name || "";
  // WATI reintenta la entrega del webhook (confirmado: mismo mensaje repetido
  // cada ~10 min si algo falla del lado nuestro) — se necesita un id estable
  // para deduplicar. whatsappMessageId es el id real de Meta; "id" es el
  // identificador interno de WATI, siempre presente como respaldo.
  const idMensaje = d.whatsappMessageId || d.id || body?.whatsappMessageId || body?.id;

  // Ignora eventos que no sean mensajes de texto entrantes (ej. "sent"/"delivered"/"read" de nuestros propios envíos).
  const esEntrante =
    d.owner === false || d.fromMe === false || tipo === "message" || tipo === "text" || (!("owner" in d) && !("fromMe" in d));

  if (!waId || !texto || !esEntrante) return null;

  return { waId: String(waId), texto: String(texto), nombre: String(nombre || ""), idMensaje: idMensaje ? String(idMensaje) : null };
}

// Detecta un mensaje SALIENTE (owner/fromMe true) que trae el nombre/correo
// de un operador humano — eso significa que TÚ contestaste desde el
// dashboard de WATI, no nuestro bot (el bot manda por API, sin operador
// logueado). Pedido explícito del usuario el 2026-09-04: en cuanto tú
// escribes directo, el bot debe dejar de responder esa conversación.
function detectarTomaDeControlHumano(body) {
  const d = body?.data || body || {};
  const waId = d.waId || d.whatsappNumber || d.phone || body?.waId;
  const esSaliente = d.owner === true || d.fromMe === true;
  const operador = d.operatorName || d.operatorEmail || d.assignedName || d.senderName || "";

  if (!waId || !esSaliente || !String(operador || "").trim()) return null;
  return { waId: String(waId), operador: String(operador).trim() };
}

async function yaFueProcesado(db, idMensaje) {
  if (!idMensaje) return false; // sin id no podemos deduplicar, se procesa (mejor a que se pierda)
  try {
    await db.collection("wati_mensajes_procesados").insertOne({ _id: idMensaje, processedAt: new Date() });
    return false; // se pudo insertar -> es la primera vez que se ve este mensaje
  } catch (err) {
    if (err?.code === 11000) return true; // ya existía -> reintento duplicado de WATI
    throw err;
  }
}

function soloDigitos(v) {
  return String(v || "").replace(/\D/g, "");
}

// Si el cliente ya habló con el bot en el widget web de qi-vanta.com y dejó
// su teléfono en el formulario, y esta es su PRIMERA vez escribiendo por
// WhatsApp, se hereda ese historial como contexto inicial — así no tiene
// que repetir lo que ya platicó. Pedido explícito del usuario el 2026-09-03
// ("para tener toda la conversación ese bot debe brincar a WATI").
async function buscarContextoWebPrevio(db, waId) {
  const digitos = soloDigitos(waId);
  if (!digitos || digitos.length < 8) return null;

  const candidatos = await db
    .collection("widget_conversaciones")
    .find({ "contacto.telefono": { $exists: true }, "contacto.vinculadoWaId": { $exists: false } })
    .sort({ "contacto.capturadoEn": -1 })
    .limit(50)
    .toArray();

  return candidatos.find((c) => soloDigitos(c.contacto.telefono).endsWith(digitos.slice(-10))) || null;
}

async function obtenerConversacion(db, waId) {
  const doc = await db.collection("wati_conversaciones").findOne({ waId });
  const humanTomoControl = !!doc?.humanTomoControl;

  if (doc?.mensajes?.length) return { mensajes: doc.mensajes, humanTomoControl };

  // Sin historial propio todavía (primer mensaje de este waId) — buscar si
  // viene de una conversación previa en el widget web.
  const previo = await buscarContextoWebPrevio(db, waId);
  if (previo?.mensajes?.length) {
    await db
      .collection("widget_conversaciones")
      .updateOne({ _id: previo._id }, { $set: { "contacto.vinculadoWaId": waId } });
    return { mensajes: previo.mensajes, humanTomoControl };
  }

  return { mensajes: [], humanTomoControl };
}

// Para cuando el bot está pausado (humanTomoControl): solo guarda el
// mensaje entrante en el historial (para que lo veas en el panel), sin
// tocar el reloj de seguimiento — ya no aplica, tú estás contestando.
async function guardarMensajeEntrante(db, waId, mensajes) {
  await db.collection("wati_conversaciones").updateOne(
    { waId },
    { $set: { waId, mensajes: mensajes.slice(-MAX_HISTORY), updatedAt: new Date() } },
    { upsert: true }
  );
}

async function guardarHistorial(db, waId, mensajes) {
  // seguimiento: arranca el reloj de los mensajes de seguimiento (30 min / 1h)
  // sin respuesta del cliente — se reinicia cada vez que el bot contesta algo nuevo.
  await db.collection("wati_conversaciones").updateOne(
    { waId },
    {
      $set: {
        waId,
        mensajes: mensajes.slice(-MAX_HISTORY),
        updatedAt: new Date(),
        seguimiento: { ultimaRespuestaBot: new Date(), seguimiento1Enviado: false, seguimiento2Enviado: false },
      },
    },
    { upsert: true }
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  console.log("WATI webhook body:", JSON.stringify(req.body));

  try {
    const db = await getDb();

    const tomaDeControl = detectarTomaDeControlHumano(req.body);
    if (tomaDeControl) {
      await db.collection("wati_conversaciones").updateOne(
        { waId: tomaDeControl.waId },
        {
          $set: {
            waId: tomaDeControl.waId,
            humanTomoControl: true,
            humanTomoControlPor: tomaDeControl.operador,
            humanTomoControlEn: new Date(),
          },
        },
        { upsert: true }
      );
      console.log(`Humano (${tomaDeControl.operador}) tomó control de la conversación con ${tomaDeControl.waId} — bot pausado ahí.`);
      res.status(200).json({ ok: true, humanTomoControl: true });
      return;
    }

    const mensaje = extraerMensajeEntrante(req.body);
    if (!mensaje) {
      // No es un mensaje de texto entrante (ej. evento de estado) — se responde 200 igual para que WATI no reintente.
      res.status(200).json({ ok: true, ignorado: true });
      return;
    }

    if (!process.env.DEEPINFRA_API_KEY) {
      console.error("Falta DEEPINFRA_API_KEY.");
      res.status(200).json({ ok: false });
      return;
    }

    if (await yaFueProcesado(db, mensaje.idMensaje)) {
      res.status(200).json({ ok: true, duplicado: true });
      return;
    }

    const { mensajes: historial, humanTomoControl } = await obtenerConversacion(db, mensaje.waId);

    if (humanTomoControl) {
      // Tú ya tomaste esta conversación — el bot solo guarda el mensaje
      // entrante (para que lo veas en el panel) y no responde nada.
      await guardarMensajeEntrante(db, mensaje.waId, [...historial, { role: "user", content: mensaje.texto }]);
      res.status(200).json({ ok: true, pausadoPorHumano: true });
      return;
    }

    const conversacion = [
      ...historial,
      { role: "user", content: mensaje.texto },
    ];

    let respuesta;
    try {
      respuesta = await chatCompletionText({
        system: SYSTEM_PROMPT + PLAIN_TEXT_FORMAT_SUFFIX,
        messages: conversacion,
        maxTokens: 700,
      });
    } catch (err) {
      console.error("Error generando respuesta con DeepInfra:", err.message);
      respuesta = "Disculpa, no pude generar una respuesta. ¿Puedes reformular tu pregunta?";
    }

    await enviarRespuestaWati(mensaje.waId, respuesta);

    await guardarHistorial(db, mensaje.waId, [
      ...conversacion,
      { role: "assistant", content: respuesta },
    ]);

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Error en wati-webhook:", err);
    // Responder 200 para que WATI no reintente en bucle un mensaje que ya falló.
    res.status(200).json({ ok: false, error: err.message });
  }
};

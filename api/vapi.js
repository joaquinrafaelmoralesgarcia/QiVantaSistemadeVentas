// Disparar (POST) y consultar (GET) llamadas de voz IA vía Vapi — consolidado
// en un solo archivo por el límite de 12 funciones serverless de Vercel Hobby.
// CORS abierto: se llama desde call-widget.js embebido en qi-vanta.com
// (origen distinto a este backend en Vercel) — pedido del usuario el
// 2026-09-04 para el botón "Llámame" del portal.
const { aplicarCors } = require("./_cors");
const { getDb } = require("./_mongo");
const { esCadenaConocida } = require("./_empresaGrande");
const { estadoFeriado } = require("./_feriadosMexico");
const { CATEGORIAS } = require("./_prospectingSegments");

const VAPI_API_URL = "https://api.vapi.ai/call";
const COOLDOWN_MS = 10 * 60 * 1000; // 10 min entre solicitudes al mismo número

// Ganchos de apertura para las llamadas en frío (Google Maps) — banco de
// frases igual que el de los asuntos de correo, elegido al azar por
// llamada — pedido explícito del usuario el 2026-09-11 ("sabes como
// puedes tener el doble de clientes?", "sabes que podemos mejorar lo que
// ofreces frente a tu competencia", etc.).
const GANCHOS_APERTURA = [
  "¿Sabe cómo podría tener el doble de clientes en su negocio?",
  "¿Sabe que podemos ayudarle a mejorar lo que ofrece frente a su competencia?",
  "¿Sabía que muchos negocios como el suyo están perdiendo clientes sin darse cuenta?",
  "¿Le gustaría saber cómo atender a más clientes sin contratar más personal?",
];

function calcularSaludo(ahora) {
  const hora = parseInt(ahora.toLocaleString("es-MX", { timeZone: "America/Mexico_City", hour: "numeric", hour12: false }), 10);
  return hora < 12 ? "buenos días" : hora < 19 ? "buenas tardes" : "buenas noches";
}

// Ventana de marcado en frío — pedido explícito del usuario el
// 2026-09-11: "el horario debe ser de 10 a 5pm y no a la hora de la
// comida que es 2 a 4pm" + "sabados y domingo nada". Se valida aquí (no
// solo en el cron de GitHub Actions) porque es la garantía real — el
// cron puede disparar de más, esta función nunca marca fuera de horario.
function dentroDeHorarioLlamadas(ahora) {
  const cdmx = new Date(ahora.toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
  const dia = cdmx.getDay(); // 0=domingo, 6=sabado
  if (dia === 0 || dia === 6) return false;

  // Días festivos oficiales de México (LFT) o excepciones puntuales —
  // pedido explícito del usuario el 2026-09-13: "los dias festivos en
  // mexico no mandes correo ni llamadas de ninguna campaña".
  const { festivoCompleto, medioDiaDesde } = estadoFeriado(cdmx);
  if (festivoCompleto) return false;

  const horaDecimal = cdmx.getHours() + cdmx.getMinutes() / 60;
  if (medioDiaDesde) {
    const [h, m] = medioDiaDesde.split(":").map(Number);
    if (horaDecimal >= h + m / 60) return false;
  }

  const enManana = horaDecimal >= 10 && horaDecimal < 14; // 10am-2pm
  const enTarde = horaDecimal >= 16 && horaDecimal < 17; // 4pm-5pm
  return enManana || enTarde;
}

function formatearContextoNegocio(negocio) {
  const partes = [
    `Nombre: ${negocio.nombre}`,
    negocio.categoria ? `Categoría: ${negocio.categoria}` : null,
    negocio.calificacionGoogle ? `Calificación en Google: ${negocio.calificacionGoogle} con ${negocio.numResenas || 0} reseñas` : null,
    `Ciudad/dirección: ${negocio.direccion || "desconocida"}`,
    `¿Tiene sitio web?: ${negocio.tieneSitioWeb ? "Sí" : "No"}`,
  ];
  return partes.filter(Boolean).join(". ");
}

// Marcador por lotes de llamadas en frío a leads de Google Maps con
// teléfono — pedido explícito del usuario el 2026-09-11. Protegido con
// CRON_SECRET (igual que los demás crons), a diferencia de
// iniciarLlamada() que es público para el botón "Llámame" del sitio.
const LOTE_LLAMADAS_FRIAS = 8; // Vapi limita a 10 llamadas simultáneas en este plan

async function marcarLlamadasFrias(req, res) {
  const vapiKey = process.env.VAPI_API_KEY;
  const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
  const assistantId = process.env.VAPI_ASSISTANT_ID_FRIO;

  if (!vapiKey || !phoneNumberId || !assistantId) {
    res.status(500).json({ error: "Falta configurar VAPI_API_KEY, VAPI_PHONE_NUMBER_ID y/o VAPI_ASSISTANT_ID_FRIO." });
    return;
  }

  const ahora = new Date();
  if (!dentroDeHorarioLlamadas(ahora)) {
    res.status(200).json({ omitido: true, motivo: "Fuera del horario permitido (10am-2pm y 4pm-5pm, Lun-Vie, hora CDMX)." });
    return;
  }

  try {
    const db = await getDb();
    const leadsCol = db.collection("leads");
    const llamadasCol = db.collection("llamadasFrio");

    const yaMarcados = await llamadasCol.find({}, { projection: { telefono: 1 } }).toArray();
    const telefonosExcluidos = new Set(yaMarcados.map((d) => d.telefono));

    // Solo México — pedido explícito del usuario el 2026-09-13: "las
    // llamadas de la campaña de google maps solo deben hacerse para
    // empresas o negocios en mexico, solo los correos son los que podran
    // irse a latam". normalizarTelefono() en _leadsProcessor.js ya
    // antepone +52 a cualquier número mexicano real, así que filtrar por
    // ese prefijo basta — un negocio de otro país de LatAm sigue
    // recibiendo correo normal, solo queda fuera de las llamadas.
    // Solo el nuevo sector (clínicas/consultorios/hospitales/escuelas) —
    // pedido explícito del usuario el 2026-09-15: "de aqui en adelante...
    // solo enviaremos... a este nuevo sector". Los negocios de fuera del
    // sector que ya estaban en la base pueden seguir su correo en curso
    // (decisión explícita del usuario, no se les corta a medias), pero
    // una llamada a alguien que nunca se le ha marcado es un contacto
    // NUEVO, así que sí aplica el filtro aquí.
    const candidatos = await leadsCol
      .find({ origenBusqueda: { $in: CATEGORIAS }, telefono: { $regex: "^\\+52" } })
      .sort({ createdAt: 1 })
      .limit(LOTE_LLAMADAS_FRIAS * 5) // margen porque muchos ya estarán excluidos
      .toArray();

    // Salvaguarda extra por si quedó guardada alguna cadena/franquicia de
    // scrapeos anteriores a este filtro (2026-09-12) — la exclusión real
    // ya vive en _leadsProcessor.js, esto es solo por si acaso.
    //
    // También depura por teléfono DENTRO de este mismo lote (no solo
    // contra llamadasFrio, que solo tiene los YA marcados de corridas
    // anteriores) — encontrado el 2026-09-13 con la validación diaria de
    // integridad: existen documentos duplicados en "leads" (mismo
    // teléfono, 2 sucursales de Apify insertadas en la misma corrida, ej.
    // "Paquetexpress"). Sin esto, si 2 duplicados caen en el mismo
    // "candidatos", ninguno está todavía en telefonosExcluidos y se
    // llamaría al mismo número 2 veces en una sola pasada — rompiendo la
    // regla explícita de "solo un intento" (pedido del usuario el
    // 2026-09-11).
    const telefonosVistosEnEsteLote = new Set();
    const elegibles = candidatos
      .filter((n) => {
        if (telefonosExcluidos.has(n.telefono) || esCadenaConocida(n.nombre)) return false;
        if (telefonosVistosEnEsteLote.has(n.telefono)) return false;
        telefonosVistosEnEsteLote.add(n.telefono);
        return true;
      })
      .slice(0, LOTE_LLAMADAS_FRIAS);

    let marcadas = 0;
    const errores = [];
    const saludo = calcularSaludo(ahora);

    for (const negocio of elegibles) {
      // Marca "marcando" ANTES de llamar a Vapi — evita que una corrida
      // paralela (o la siguiente, si esta se pasa del tiempo) vuelva a
      // seleccionar el mismo número antes de que el webhook confirme el
      // resultado real.
      await llamadasCol.updateOne(
        { telefono: negocio.telefono },
        { $set: { estado: "marcando", nombreNegocio: negocio.nombre, ubicacionGoogleMaps: negocio.googleMapsUrl || null, iniciadoEn: ahora } },
        { upsert: true }
      );

      try {
        const vapiRes = await fetch(VAPI_API_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${vapiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            phoneNumberId,
            customer: { number: negocio.telefono },
            assistantId,
            metadata: { nombreNegocio: negocio.nombre, ubicacionGoogleMaps: negocio.googleMapsUrl || null },
            assistantOverrides: {
              variableValues: {
                contextoNegocio: formatearContextoNegocio(negocio),
                ganchoApertura: GANCHOS_APERTURA[Math.floor(Math.random() * GANCHOS_APERTURA.length)],
                saludo,
              },
            },
          }),
        });
        const data = await vapiRes.json();
        if (!vapiRes.ok) throw new Error(data.message || JSON.stringify(data));
        await llamadasCol.updateOne({ telefono: negocio.telefono }, { $set: { callId: data.id } });
        marcadas++;
      } catch (err) {
        errores.push({ telefono: negocio.telefono, error: err.message });
        // Si Vapi rechazó la llamada, no la dejamos en "marcando" para
        // siempre — se libera para reintentar en la siguiente corrida.
        await llamadasCol.deleteOne({ telefono: negocio.telefono, estado: "marcando" });
      }
    }

    res.status(200).json({ revisados: candidatos.length, elegibles: elegibles.length, marcadas, errores });
  } catch (err) {
    console.error("Error en marcarLlamadasFrias:", err);
    res.status(500).json({ error: err.message || "Error marcando llamadas en frío." });
  }
}

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
  // Ruta del marcador por lotes (cron) — se distingue de iniciarLlamada()
  // por traer el CRON_SECRET, igual que los demás crons del proyecto. Va
  // ANTES de aplicarCors/iniciarLlamada porque es una ruta interna, no la
  // pública del botón "Llámame".
  if (req.method === "POST" && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`) {
    return marcarLlamadasFrias(req, res);
  }

  if (aplicarCors(req, res)) return;
  if (req.method === "POST") return iniciarLlamada(req, res);
  if (req.method === "GET") return consultarLlamada(req, res);
  res.status(405).json({ error: "Method not allowed" });
};

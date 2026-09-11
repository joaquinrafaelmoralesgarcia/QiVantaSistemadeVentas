const { generarScript } = require("./_leadScript");
const { agregarLeadACampania } = require("./_smartlead");
const { correoTieneServidorValido } = require("./_emailVerify");

function normalizarTelefono(tel) {
  const digits = String(tel || "").replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+52${digits}`;
  if (digits.length === 12 && digits.startsWith("52")) return `+${digits}`;
  return digits ? `+52${digits}` : "";
}

// Dedup + calificación con Claude (en paralelo) + inserción en Mongo.
// Idempotente: si se llama dos veces con los mismos negocios (ej. el
// frontend hace polling y llega a llamar esto más de una vez), la segunda
// corrida los encuentra como duplicados y no inserta nada de más.
async function procesarNegocios(coleccion, negocios, query) {
  const telefonos = negocios.map((n) => normalizarTelefono(n.telefono)).filter(Boolean);
  const urls = negocios.map((n) => n.googleMapsUrl).filter(Boolean);
  const existentes = await coleccion
    .find({ $or: [{ telefono: { $in: telefonos } }, { googleMapsUrl: { $in: urls } }] })
    .project({ telefono: 1, googleMapsUrl: 1 })
    .toArray();
  const telefonosExistentes = new Set(existentes.map((e) => e.telefono));
  const urlsExistentes = new Set(existentes.map((e) => e.googleMapsUrl));

  const nuevosNegocios = [];
  let duplicados = 0;
  for (const negocio of negocios) {
    const telefono = normalizarTelefono(negocio.telefono);
    if (telefonosExistentes.has(telefono) || urlsExistentes.has(negocio.googleMapsUrl)) {
      duplicados++;
      continue;
    }
    nuevosNegocios.push({ ...negocio, telefono });
  }

  // Verifica que el dominio del correo scrapeado exista y acepte correo
  // (registros MX) ANTES de mandarlo a Smartlead — pedido del usuario el
  // 2026-09-04 tras ver su bandeja llena de rebotes. No es verificación
  // completa (no confirma que el buzón específico exista), pero descarta
  // la causa más común y más barata de detectar: dominios muertos o mal
  // escritos. Si sale inválido, se trata como "solo teléfono" en vez de
  // descartar el lead — sigue siendo contactable por WhatsApp cuando esté
  // disponible.
  let correosInvalidos = 0;
  await Promise.all(
    nuevosNegocios.map(async (negocio) => {
      if (!negocio.correo) return;
      const valido = await correoTieneServidorValido(negocio.correo);
      if (!valido) {
        negocio.correoInvalido = negocio.correo;
        negocio.correo = null;
        correosInvalidos++;
      }
    })
  );

  const scripts = await Promise.all(
    nuevosNegocios.map((negocio) =>
      generarScript(negocio).catch((err) => {
        console.error("Error generando script para", negocio.nombre, err);
        return null;
      })
    )
  );

  let conCorreo = 0;
  let soloTelefono = 0;
  let correosEnviados = 0;
  let erroresCorreo = 0;

  const leads = [];
  for (let i = 0; i < nuevosNegocios.length; i++) {
    const negocio = nuevosNegocios[i];
    const script = scripts[i];
    const asuntoEmail = script?.asuntoEmail || (negocio.correo ? `Automatización e IA para ${negocio.nombre}` : "");
    const cuerpoEmail = script?.cuerpoEmail || "";
    const seguimiento1Asunto = script?.seguimiento1Asunto || "";
    const seguimiento1 = script?.seguimiento1 || "";
    const seguimiento2Asunto = script?.seguimiento2Asunto || "";
    const seguimiento2 = script?.seguimiento2 || "";

    const lead = {
      ...negocio,
      calificacion: script?.calificacion || null,
      razonamiento: script?.razonamiento || "",
      mensajeWhatsapp: script?.mensajeWhatsapp || "",
      asuntoEmail,
      cuerpoEmail,
      seguimiento1Asunto,
      seguimiento1,
      seguimiento2Asunto,
      seguimiento2,
      estado: "nuevo",
      emailEstado: null, // null | "enviado_a_campana" | "error"
      origenBusqueda: query,
      createdAt: new Date(),
    };

    if (negocio.correo) {
      conCorreo++;
      // El correo se manda automático a la campaña de Smartlead — el
      // asunto/cuerpo ya lo revisas/editas en el panel DESPUÉS (Smartlead
      // solo dispara el envío real cuando tú actives la campaña ahí).
      try {
        await agregarLeadACampania({
          nombre: negocio.nombre,
          correo: negocio.correo,
          empresa: negocio.nombre,
          telefono: negocio.telefono,
          customFields: {
            qi_vanta_subject: asuntoEmail,
            qi_vanta_message: cuerpoEmail,
            qi_vanta_followup1_subject: seguimiento1Asunto,
            qi_vanta_followup1: seguimiento1,
            qi_vanta_followup2_subject: seguimiento2Asunto,
            qi_vanta_followup2: seguimiento2,
          },
        });
        lead.emailEstado = "enviado_a_campana";
        correosEnviados++;
      } catch (err) {
        console.error("Error mandando a Smartlead:", negocio.nombre, err.message);
        lead.emailEstado = "error";
        lead.emailError = err.message;
        erroresCorreo++;
      }
    } else {
      soloTelefono++;
    }

    leads.push(lead);
  }

  if (leads.length) await coleccion.insertMany(leads);

  return { totalEncontrados: negocios.length, nuevos: leads.length, duplicados, conCorreo, soloTelefono, correosEnviados, erroresCorreo, correosInvalidos };
}

module.exports = { procesarNegocios, normalizarTelefono };

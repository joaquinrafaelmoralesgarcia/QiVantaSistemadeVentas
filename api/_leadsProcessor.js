const { generarScript } = require("./_leadScript");
const { agregarLeadACampania } = require("./_smartlead");
const { correoTieneServidorValido } = require("./_emailVerify");
const { esCadenaConocida, esCorreoDePlataformaExcluida, esInmobiliaria } = require("./_empresaGrande");

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

  // Depura tanto contra lo que YA existe en la base (arriba) como DENTRO
  // del propio lote que llegó de Apify en esta misma corrida — encontrado
  // el 2026-09-13 con la validación diaria de integridad: cuando Apify
  // trae 2 sucursales distintas (google_place_id distinto) con el mismo
  // teléfono en la MISMA corrida ("Paquetexpress" x2, 663ms de
  // diferencia), ninguna de las 2 existía todavía en Mongo, así que el
  // chequeo de arriba no las detectaba y ambas se insertaban — un
  // teléfono duplicado real en la base, con el riesgo directo de que el
  // marcador de llamadas le marque al mismo número 2 veces en una sola
  // pasada.
  const telefonosVistosEnEsteLote = new Set();
  const urlsVistasEnEsteLote = new Set();
  const nuevosNegocios = [];
  let duplicados = 0;
  for (const negocio of negocios) {
    const telefono = normalizarTelefono(negocio.telefono);
    const yaExiste = telefonosExistentes.has(telefono) || urlsExistentes.has(negocio.googleMapsUrl);
    const yaEnEsteLote = (telefono && telefonosVistosEnEsteLote.has(telefono)) || (negocio.googleMapsUrl && urlsVistasEnEsteLote.has(negocio.googleMapsUrl));
    if (yaExiste || yaEnEsteLote) {
      duplicados++;
      continue;
    }
    if (telefono) telefonosVistosEnEsteLote.add(telefono);
    if (negocio.googleMapsUrl) urlsVistasEnEsteLote.add(negocio.googleMapsUrl);
    nuevosNegocios.push({ ...negocio, telefono });
  }

  // Excluye cadenas/franquicias conocidas (OXXO, 7-Eleven, Super K,
  // McDonald's, etc.) — pedido explícito del usuario el 2026-09-12:
  // "quita de la campaña google maps, cadenas de este tipo... debes
  // omitirlas en los scrapeos de apify igual para no mandarles ni correo
  // ni llamadas a estos negocios que sean cadenas". Se descartan ANTES de
  // validar correo/generar contenido/guardar — nunca llegan a "leads",
  // así que tampoco pueden entrar al marcador de llamadas (que solo toma
  // de esa colección). No usa reseñas/categoría (eso sigue yendo al
  // catálogo "empresa grande" normal) — solo coincidencia de nombre con
  // una cadena conocida, la señal inequívoca de que es una sucursal sin
  // autoridad de compra propia.
  // También excluye bienes raíces/inmobiliarias — pedido explícito del
  // usuario el 2026-09-15, mismo criterio de exclusión completa que las
  // cadenas.
  let excluidosCadena = 0;
  let excluidosInmobiliaria = 0;
  const negociosFiltrados = [];
  for (const negocio of nuevosNegocios) {
    if (esCadenaConocida(negocio.nombre)) {
      excluidosCadena++;
      continue;
    }
    if (esInmobiliaria(negocio)) {
      excluidosInmobiliaria++;
      continue;
    }
    negociosFiltrados.push(negocio);
  }
  nuevosNegocios.length = 0;
  nuevosNegocios.push(...negociosFiltrados);

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
      // Correo de plataforma/agregador (ej. Doctoralia) — mismo trato que
      // un dominio con MX inválido: no se manda correo, pero el negocio
      // sigue siendo contactable por teléfono. Se revisa antes de la
      // verificación MX porque el dominio en sí (doctoralia.com) sí tiene
      // MX válido — no lo detectaría esa validación.
      const plataforma = esCorreoDePlataformaExcluida(negocio.correo);
      if (plataforma) {
        negocio.correoInvalido = negocio.correo;
        negocio.correo = null;
        correosInvalidos++;
        return;
      }
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

  return { totalEncontrados: negocios.length, nuevos: leads.length, duplicados, excluidosCadena, excluidosInmobiliaria, conCorreo, soloTelefono, correosEnviados, erroresCorreo, correosInvalidos };
}

module.exports = { procesarNegocios, normalizarTelefono };

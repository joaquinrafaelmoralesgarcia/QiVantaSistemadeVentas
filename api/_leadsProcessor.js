const { generarScript } = require("./_leadScript");

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
  const leads = nuevosNegocios.map((negocio, i) => {
    const script = scripts[i];
    if (negocio.correo) conCorreo++;
    else soloTelefono++;
    return {
      ...negocio,
      calificacion: script?.calificacion || null,
      razonamiento: script?.razonamiento || "",
      mensajeWhatsapp: script?.mensajeWhatsapp || "",
      asuntoEmail: script?.asuntoEmail || (negocio.correo ? `Automatización e IA para ${negocio.nombre}` : ""),
      cuerpoEmail: script?.cuerpoEmail || "",
      estado: "nuevo",
      emailEstado: negocio.correo ? "pendiente" : null,
      origenBusqueda: query,
      createdAt: new Date(),
    };
  });

  if (leads.length) await coleccion.insertMany(leads);

  return { totalEncontrados: negocios.length, nuevos: leads.length, duplicados, conCorreo, soloTelefono };
}

module.exports = { procesarNegocios, normalizarTelefono };

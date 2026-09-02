const { getDb } = require("./_mongo");
const { requiereAdmin } = require("./_adminAuth");
const { buscarNegocios } = require("./_apify");
const { generarScript } = require("./_leadScript");

function normalizarTelefono(tel) {
  const digits = String(tel || "").replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+52${digits}`;
  if (digits.length === 12 && digits.startsWith("52")) return `+${digits}`;
  return digits ? `+52${digits}` : "";
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!requiereAdmin(req, res)) return;

  try {
    const { query, location, maxResultados } = req.body || {};
    if (!query) {
      res.status(400).json({ error: "Falta 'query' (ej. 'gimnasios')." });
      return;
    }

    const negocios = await buscarNegocios({ query, location, maxResultados: maxResultados || 30 });
    const db = await getDb();
    const coleccion = db.collection("leads");

    let nuevos = 0;
    let duplicados = 0;
    let conCorreo = 0;
    let soloTelefono = 0;

    for (const negocio of negocios) {
      const telefono = normalizarTelefono(negocio.telefono);
      const existente = await coleccion.findOne({ $or: [{ telefono }, { googleMapsUrl: negocio.googleMapsUrl }] });
      if (existente) {
        duplicados++;
        continue;
      }

      let script = null;
      try {
        script = await generarScript(negocio);
      } catch (err) {
        console.error("Error generando script para", negocio.nombre, err);
      }

      const lead = {
        ...negocio,
        telefono,
        calificacion: script?.calificacion || null,
        razonamiento: script?.razonamiento || "",
        mensajeWhatsapp: script?.mensajeWhatsapp || "",
        asuntoEmail: script?.asuntoEmail || (negocio.correo ? `Automatización e IA para ${negocio.nombre}` : ""),
        cuerpoEmail: script?.cuerpoEmail || "",
        estado: "nuevo", // nuevo | contactado | descartado
        // El correo YA NO se manda automático — queda "pendiente" para que se
        // revise/edite en el panel antes de disparar (api/leads-send-email.js).
        emailEstado: negocio.correo ? "pendiente" : null, // null | "pendiente" | "enviado_a_campana" | "error"
        origenBusqueda: query,
        createdAt: new Date(),
      };

      if (negocio.correo) conCorreo++;
      else soloTelefono++;

      await coleccion.insertOne(lead);
      nuevos++;
    }

    res.status(200).json({
      totalEncontrados: negocios.length,
      nuevos,
      duplicados,
      conCorreo,
      soloTelefono,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error al buscar y calificar negocios." });
  }
};

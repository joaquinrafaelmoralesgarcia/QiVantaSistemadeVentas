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

    // Chequeo de duplicados en un solo query (en vez de uno por negocio) para
    // no gastar el tiempo límite de la función (Hobby: 60s) en round-trips
    // secuenciales a Mongo.
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

    // Los llamados a Claude van en paralelo (antes eran secuenciales y con
    // 10 negocios se pasaba del límite de 60s de la función en Vercel Hobby).
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
        estado: "nuevo", // nuevo | contactado | descartado
        // El correo YA NO se manda automático — queda "pendiente" para que se
        // revise/edite en el panel antes de disparar (api/leads-send-email.js).
        emailEstado: negocio.correo ? "pendiente" : null, // null | "pendiente" | "enviado_a_campana" | "error"
        origenBusqueda: query,
        createdAt: new Date(),
      };
    });

    if (leads.length) await coleccion.insertMany(leads);

    res.status(200).json({
      totalEncontrados: negocios.length,
      nuevos: leads.length,
      duplicados,
      conCorreo,
      soloTelefono,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error al buscar y calificar negocios." });
  }
};

// Exporta los leads creados dentro de una ventana concreta a dos archivos
// Excel: uno de Apollo y otro de Apify. No modifica campañas ni contactos.
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const XLSX = require("xlsx");

const desde = new Date(process.env.CAPTACION_DESDE_UTC || "");
const hasta = new Date(process.env.CAPTACION_HASTA_UTC || "");
if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime())) {
  throw new Error("CAPTACION_DESDE_UTC y CAPTACION_HASTA_UTC deben ser fechas UTC válidas.");
}
if (!process.env.MONGODB_URI) throw new Error("Falta MONGODB_URI.");

const salida = path.resolve(process.env.EXPORT_DIR || "exports");
fs.mkdirSync(salida, { recursive: true });

function fila(lead) {
  return {
    nombre: lead.nombre || lead.first_name || "",
    empresa: lead.empresa || lead.company || "",
    correo: lead.correo || lead.email || "",
    telefono: lead.telefono || "",
    origen: lead.origen || (lead.origenBusqueda ? "apify_google_maps" : ""),
    busqueda: lead.origenBusqueda || "",
    campana: lead.campaignName || "",
    estado: lead.estado || "",
    emailEstado: lead.emailEstado || "",
    creadoEnUTC: lead.createdAt ? new Date(lead.createdAt).toISOString() : "",
  };
}

function escribir(nombre, registros) {
  const libro = XLSX.utils.book_new();
  const hoja = XLSX.utils.json_to_sheet(registros.map(fila));
  hoja["!cols"] = [
    { wch: 28 }, { wch: 34 }, { wch: 38 }, { wch: 18 }, { wch: 22 },
    { wch: 32 }, { wch: 34 }, { wch: 22 }, { wch: 24 }, { wch: 25 },
  ];
  XLSX.utils.book_append_sheet(libro, hoja, "Leads");
  const archivo = path.join(salida, nombre);
  XLSX.writeFile(libro, archivo);
  return archivo;
}

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const leads = client.db(process.env.MONGODB_DB || "qivanta_chatbot").collection("leads");
    const periodo = { $gte: desde, $lt: hasta };
    const [apollo, apify] = await Promise.all([
      leads.find({ createdAt: periodo, origen: "apollo_latam" }).sort({ createdAt: 1 }).toArray(),
      leads.find({ createdAt: periodo, origenBusqueda: { $exists: true, $ne: "" } }).sort({ createdAt: 1 }).toArray(),
    ]);
    const fecha = hasta.toISOString().slice(0, 10);
    const archivos = [
      escribir(`leads-apollo-${fecha}.xlsx`, apollo),
      escribir(`leads-apify-${fecha}.xlsx`, apify),
    ];
    console.log(JSON.stringify({ desde: desde.toISOString(), hasta: hasta.toISOString(), apollo: apollo.length, apify: apify.length, archivos }, null, 2));
  } finally {
    await client.close();
  }
})().catch((err) => { console.error(err.message); process.exitCode = 1; });

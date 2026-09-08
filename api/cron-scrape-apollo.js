// Scrapeo diario de contactos LATAM vía Apollo.io — pedido explícito del
// usuario el 2026-09-07: "en apollo debe obtenerse nuevos contactos
// diario, latam, todo tipo de empresa, 150 diarios" y "no hay que sacar
// ningún teléfono solo correos". Espejo de cron-scrape.js (Apify/Google
// Maps) pero sin el ciclo async iniciar/consultar — la búsqueda de Apollo
// responde de inmediato, así que cada llamada POST procesa una página
// completa y devuelve el resultado ya terminado.
//
// El cursor de página se guarda en Mongo (colección "estadoApollo") y solo
// avanza cuando la página se procesó sin detenerse por falta de créditos
// — si se detiene, la siguiente corrida reintenta la MISMA página; el
// dedup por apolloId en _leadsProcessorEmpresa hace que reintentarla sea
// seguro y barato (los candidatos ya resueltos se saltan de inmediato).
const { getDb } = require("./_mongo");
const { buscarPersonas } = require("./_apollo");
const { procesarPersonasApollo } = require("./_leadsProcessorEmpresa");

const PER_PAGE = 100;

module.exports = async function handler(req, res) {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: "No autorizado." });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const db = await getDb();
    const estadoCol = db.collection("estadoApollo");
    const estado = (await estadoCol.findOne({ _id: "cursorLatam" })) || { pagina: 1 };

    const { totalEncontrados, personas } = await buscarPersonas({ page: estado.pagina, perPage: PER_PAGE });

    if (!personas.length) {
      // Se acabó esta vuelta del universo de candidatos (o la página quedó
      // vacía) — reinicia desde la página 1 para la próxima corrida.
      await estadoCol.updateOne({ _id: "cursorLatam" }, { $set: { pagina: 1 } }, { upsert: true });
      res.status(200).json({ paginaUsada: estado.pagina, totalEncontrados, sinCandidatosEnPagina: true, reinicio: true });
      return;
    }

    const stats = await procesarPersonasApollo(db.collection("leads"), personas);

    if (!stats.detenidoPorErrores) {
      await estadoCol.updateOne({ _id: "cursorLatam" }, { $set: { pagina: estado.pagina + 1 } }, { upsert: true });
    }

    console.log("Apollo LATAM página", estado.pagina, ":", JSON.stringify(stats));
    res.status(200).json({ paginaUsada: estado.pagina, totalEncontrados, ...stats });
  } catch (err) {
    console.error("Error en cron-scrape-apollo:", err);
    res.status(500).json({ error: err.message || "Error en el scrapeo diario de Apollo." });
  }
};

// Disparar (POST) y consultar (GET) el scrapeo diario de leads en un solo
// archivo — Vercel Hobby limita a 12 funciones serverless por deployment,
// así que se consolidan endpoints relacionados en vez de un archivo por ruta.
const { getDb } = require("./_mongo");
const { iniciarBusqueda, consultarBusqueda } = require("./_apify");
const { procesarNegocios } = require("./_leadsProcessor");
const { elegirComboNuevo } = require("./_prospectingSegments");

const MAX_RESULTADOS = 50;

module.exports = async function handler(req, res) {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: "No autorizado." });
    return;
  }

  try {
    if (req.method === "POST") {
      const db = await getDb();
      const { categoria: query, ciudad: location, combosRestantes, reinicio } = await elegirComboNuevo(db);
      const { runId } = await iniciarBusqueda({ query, location, maxResultados: MAX_RESULTADOS });
      console.log(`Scrapeo diario iniciado: "${query}" en "${location}" (runId ${runId}) — combos nuevos restantes: ${combosRestantes}${reinicio ? " (se reinició el conteo, ya se cubrió todo el universo)" : ""}`);
      res.status(200).json({ runId, query, location, combosRestantes, reinicio });
      return;
    }

    if (req.method === "GET") {
      const { runId, query } = req.query || {};
      if (!runId) {
        res.status(400).json({ error: "Falta 'runId'." });
        return;
      }

      const resultado = await consultarBusqueda(runId);
      if (!resultado.listo) {
        res.status(200).json({ listo: false, status: resultado.status });
        return;
      }

      const db = await getDb();
      // 2026-10-24: los laboratorios caian todos en Google Maps y la campana
      // de Laboratorios se quedo sin leads. Ahora van a su propia campana.
      const campana = /laborator/i.test(query || "")
        ? { key: "laboratorios", id: "4093548", name: "Qi-Vanta | Laboratorios | Nuevos" }
        : {};
      const stats = await procesarNegocios(db.collection("leads"), resultado.negocios, query || "", campana);
      console.log("Scrapeo diario terminado:", JSON.stringify(stats));
      res.status(200).json({ listo: true, ...stats });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Error en cron-scrape:", err);
    res.status(500).json({ error: err.message || "Error en el scrapeo diario." });
  }
};

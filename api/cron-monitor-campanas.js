// Monitor diario de salud de todo el sistema (no solo campañas) — pedido
// original el 2026-09-05 tras encontrar Piloto LATAM bloqueada sin que
// nadie lo notara. Ampliado el 2026-09-08 tras un incidente real: un
// deploy nunca llegó a producción (la conexión Git↔Vercel estaba rota) y
// el cron diario de Apollo/Hunter estuvo llamando a una ruta que ya no
// existía, sin que nada lo detectara — el usuario tuvo que enterarse por
// un correo de fallo de GitHub Actions. Pregunta del usuario: "porque yo
// tengo que estar detectando estas cosas, tu sistema debe de estar
// validando todo esto". Esto agrega justo esa validación automática.
//
// Corre cada mañana ANTES de la ventana de envío (8:00-10:00am CDMX) vía
// GitHub Actions.
const { enviarCorreoInterno } = require("./_mailer");
const { getDb } = require("./_mongo");

const SMARTLEAD_BASE_URL = "https://server.smartlead.ai/api/v1";
const SITIO_BASE_URL = "https://chatbotwati.vercel.app";

const CAMPANAS_A_VIGILAR = [
  { id: "3890342", nombre: "Qi-Vanta | Apify Google Maps" },
  { id: "3842244", nombre: "Qi-Vanta | Piloto LATAM | Decisores" },
];

// Rutas de las que depende el scrapeo diario — si cualquiera de estas
// devuelve 404 en producción, algo no se desplegó (exactamente lo que pasó
// el 2026-09-08). Se llaman SIN el header de autorización a propósito:
// nunca deben disparar la acción real (que cuesta créditos/dinero), solo
// confirmar que la ruta existe. 401 = existe y la guarda de CRON_SECRET
// funciona (correcto). 404 = la ruta no existe en el deploy actual (mal).
const RUTAS_A_VIGILAR = ["/api/cron-scrape", "/api/cron-scrape-empresas", "/api/cron-seguimiento"];

async function obtenerCampania(id) {
  const apiKey = process.env.SMARTLEAD_API_KEY;
  const res = await fetch(`${SMARTLEAD_BASE_URL}/campaigns/${id}?api_key=${encodeURIComponent(apiKey)}`);
  if (!res.ok) throw new Error(`No se pudo consultar la campaña ${id} (${res.status})`);
  return res.json();
}

async function reactivarCampania(id) {
  const apiKey = process.env.SMARTLEAD_API_KEY;
  const res = await fetch(`${SMARTLEAD_BASE_URL}/campaigns/${id}/status?api_key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "START" }),
  });
  if (!res.ok) throw new Error(`No se pudo reactivar la campaña ${id} (${res.status})`);
}

async function verificarRuta(ruta) {
  const res = await fetch(`${SITIO_BASE_URL}${ruta}`, { method: "POST" }); // sin Authorization a propósito, nunca debe ejecutar la acción real
  return res.status;
}

async function contarActividadReciente(db) {
  const hace36h = new Date(Date.now() - 36 * 60 * 60 * 1000);
  const googleMaps = await db.collection("leads").countDocuments({ origenBusqueda: { $exists: true }, createdAt: { $gte: hace36h } });
  const pilotoLatam = await db.collection("leads").countDocuments({
    origen: { $in: ["apollo_latam", "hunter_latam", "clay_latam", "snov_latam", "lusha_latam", "kaspr_latam", "importacion_manual"] },
    createdAt: { $gte: hace36h },
  });
  return { googleMaps, pilotoLatam };
}

module.exports = async function handler(req, res) {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: "No autorizado." });
    return;
  }

  const hallazgos = [];

  try {
    // 1. Estado de las campañas (chequeo original, sin cambios)
    for (const campania of CAMPANAS_A_VIGILAR) {
      try {
        const datos = await obtenerCampania(campania.id);
        if (datos.status === "COMPLETED") {
          await reactivarCampania(campania.id);
          hallazgos.push(`"${campania.nombre}" estaba en COMPLETED (se acabó su secuencia) — la reactivé automáticamente.`);
        } else if (datos.status === "PAUSED") {
          hallazgos.push(`⚠️ "${campania.nombre}" está en PAUSED — NO la toqué (podría ser una pausa intencional tuya). Revísala si no la pausaste tú.`);
        }
      } catch (err) {
        hallazgos.push(`Error revisando "${campania.nombre}": ${err.message}`);
      }
    }

    // 2. Las rutas de scrapeo diario existen en el deploy actual
    for (const ruta of RUTAS_A_VIGILAR) {
      try {
        const status = await verificarRuta(ruta);
        if (status === 404) {
          hallazgos.push(`🔴 "${ruta}" no existe en el deploy actual (404) — un push probablemente no llegó a producción. Revisar Vercel.`);
        } else if (status !== 401) {
          hallazgos.push(`⚠️ "${ruta}" respondió con estado inesperado (${status}), se esperaba 401 (ruta protegida funcionando bien).`);
        }
      } catch (err) {
        hallazgos.push(`🔴 No se pudo contactar "${ruta}": ${err.message} — el sitio podría estar caído.`);
      }
    }

    // 3. ¿Hubo actividad real en las últimas 36h? Google Maps no depende
    // de créditos de Apollo, así que en 0 un día entre semana es señal
    // fuerte de que algo se rompió (no solo falta de crédito).
    const db = await getDb();
    const actividad = await contarActividadReciente(db);
    const hoyEsEntreSemana = ![0, 6].includes(new Date().getUTCDay());
    if (actividad.googleMaps === 0 && hoyEsEntreSemana) {
      hallazgos.push(`🔴 Cero leads nuevos de Google Maps en las últimas 36h (entre semana) — el scrapeo diario probablemente no corrió.`);
    }
    if (hallazgos.length) {
      hallazgos.push(`(Contexto: Google Maps ${actividad.googleMaps} leads nuevos, Piloto LATAM ${actividad.pilotoLatam} leads nuevos en las últimas 36h.)`);
    }

    if (hallazgos.length && process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
      await enviarCorreoInterno({
        asunto: `Monitor diario: ${hallazgos.length} hallazgo(s)`,
        texto: hallazgos.join("\n\n"),
      });
    }

    res.status(200).json({ ok: true, hallazgos, actividad });
  } catch (err) {
    console.error("Error en cron-monitor-campanas:", err);
    res.status(500).json({ error: err.message });
  }
};

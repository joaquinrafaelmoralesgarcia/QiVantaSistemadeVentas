// Guarda en Mongo el contenido real de CADA respuesta de correo de
// cualquier campaña (Google Maps, Piloto LATAM, Alianzas, y cualquier
// otra que se agregue después), y notifica a joaquin.morales@qi-vanta.com
// toda respuesta nueva a joaquin.morales@qi-vanta.com — pedido explícito del
// usuario el 2026-09-22 ("de cualquier campaña si alguien contesta un
// correo... buzón maestro de smartlead") y ampliado el 2026-09-26:
// "quiero que guardes esto respuestas... en nuestra base de datos" +
// corregir que rebotes/fuera-de-oficina/bots de ticket no cuenten como
// respuesta real (encontrado con las primeras 13: Adriana era un rebote
// en alemán, 3 eran fuera-de-oficina, 5 eran bots de "recibimos tu
// mensaje" — solo 1 de 13 (Pablo, Tul) era interés real).
//
// Guarda TODO (real, rebote, fuera de oficina, bot) en Mongo — la
// clasificación se conserva en Mongo para facilitar revisión; no descarta ni
// retrasa una notificación.
//
// Corre como script directo (no endpoint de Vercel) — el plan Hobby ya
// está en el tope de 12 funciones serverless. Mismo patrón que
// validar-integridad.js/sincronizar-aperturas.js.
//
// Dedup real contra Mongo (colección "respuestasNotificadas", clave
// email_lead_map_id) — sin esto, cada corrida volvería a procesar TODAS
// las respuestas históricas, no solo las nuevas.
const fs = require("fs");
const path = require("path");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const { getDb } = require("../api/_mongo");
const { obtenerRespuestasMasterInbox } = require("../api/_smartlead");
const { enviarCorreoInterno } = require("../api/_mailer");

const SMARTLEAD_BASE_URL = "https://server.smartlead.ai/api/v1";

// Reglas de clasificación por palabra clave — ver hallazgo real del
// 2026-09-26 (13 respuestas: 1 real, 2 rechazo real, 3 fuera de oficina,
// 5 bots de ticket, 1 rebote, 1 sin contenido). Nunca perfecto, por eso
// se guarda el texto completo siempre — esto solo decide la etiqueta.
function clasificar(texto) {
  const t = (texto || "").toLowerCase();
  // 2026-10-16: "no estamos interesados" caia como bot_ticket (el hilo citado
  // traia la palabra "ticket"), "rechazó tus mensajes" como posible_real y
  // "ya no trabaja para..." tambien. Estas tres se revisan ANTES del resto.
  if (/rechaz[óo] (tus|sus) mensajes|no se pudo (entregar|encontrar)|delivery (failed|status notification)|mailer-daemon|nicht gefunden|konnte nicht gefunden|undeliverable|fehler bei der nachrichtenzustellung/i.test(t)) return "rebote";
  if (/no (estamos|estoy|me encuentro) interesad[oa]s?|no nos interesa|no me interesa|no gracias|favor de no (volver|contactar)|darme de baja|unsubscribe|remove me/i.test(t.slice(0, 400))) return "rechazo";
  if (/ya no (trabaja|labora|se encuentra|forma parte)|no (trabaja|labora) (ya )?(para|en|con)|dej[óo] de (trabajar|laborar)/i.test(t)) return "persona_ya_no_trabaja";
  if (/fuera de (la )?oficina|de licencia|estar[ée] ausente|out of office|estoy de vacaciones|ausente del|ausente hasta/i.test(t)) return "fuera_de_oficina";
  if (/hemos recibido tu (mensaje|solicitud)|ticket|folio|zendesk|equipo de atenci[oó]n a client|te responderemos (lo antes posible|tan pronto)|reporte no\.|nro?\. de seguimiento/i.test(t)) return "bot_ticket";
  if (!t.trim()) return "sin_contenido";
  return "posible_real";
}

async function obtenerTextoRespuesta(campaignId, leadId) {
  const apiKey = process.env.SMARTLEAD_API_KEY;
  const res = await fetch(`${SMARTLEAD_BASE_URL}/campaigns/${campaignId}/leads/${leadId}/message-history?api_key=${encodeURIComponent(apiKey)}`);
  const data = await res.json().catch(() => ({}));
  const reply = (data.history || []).slice().reverse().find((h) => h.type === "REPLY");
  if (!reply) return "";
  return (reply.email_body || "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&(#x1F[0-9A-F]{2}|#\d+|[a-z]+);/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

(async () => {
  const db = await getDb();
  const col = db.collection("respuestasNotificadas");

  const respuestas = await obtenerRespuestasMasterInbox();
  console.log(`Respuestas totales en el buzón maestro: ${respuestas.length}`);

  let nuevas = 0;
  let notificadasPorCorreo = 0;
  for (const r of respuestas) {
    // Solo brinca las que YA tienen clasificación guardada — así una
    // corrida nueva del código (con clasificar() ya agregado) reprocesa y
    // completa las que se habían guardado antes sin texto/clasificación,
    // en vez de dejarlas incompletas para siempre.
    const yaGuardada = await col.findOne({ _id: r.email_lead_map_id });
    if (yaGuardada && yaGuardada.clasificacion) continue;

    const nombre = [r.lead_first_name, r.lead_last_name].filter(Boolean).join(" ") || r.lead_email;
    const cuerpoRespuesta = await obtenerTextoRespuesta(r.email_campaign_id, r.email_lead_id);
    const clasificacion = clasificar(cuerpoRespuesta);

    console.log(`[${clasificacion}] ${nombre} <${r.lead_email}> — ${r.email_campaign_name}`);

    // Toda respuesta de cualquier campaña se reenvía al usuario: interés,
    // rechazo, rebote, fuera de oficina o bot. El envío de la notificación
    // NUNCA debe tumbar el guardado en Mongo.
    // — encontrado en real el 2026-09-26: la cuenta de GMAIL_USER también
    // tenía el login inválido (mismo patrón "Invalid credentials" que las
    // de Smartlead) y, sin este try/catch, una sola falla de correo
    // abortaba el resto del lote sin guardar nada más.
    if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
      try {
        await enviarCorreoInterno({
          to: "joaquin.morales@qi-vanta.com",
          asunto: `Nueva respuesta [${clasificacion}]: ${nombre} (${r.email_campaign_name})`,
          texto: [
            `Campaña: ${r.email_campaign_name}`,
            `Lead: ${nombre} <${r.lead_email}>`,
            `Última vez que se le mandó correo: ${r.last_sent_time}`,
            `Hora de la respuesta: ${r.last_reply_time}`,
            ``,
            `Respuesta:`,
            cuerpoRespuesta || "(no se pudo extraer el texto — revisa el buzón maestro de Smartlead)",
          ].join("\n"),
        });
        notificadasPorCorreo++;
      } catch (err) {
        console.error(`Error mandando notificación por correo de "${nombre}":`, err.message);
      }
    }

    await col.updateOne(
      { _id: r.email_lead_map_id },
      { $set: { ...r, cuerpoRespuesta, clasificacion, guardadoEn: new Date() } },
      { upsert: true }
    );
    nuevas++;
  }

  console.log(`=== ${nuevas} respuesta(s) nueva(s) guardada(s) en Mongo (colección "respuestasNotificadas"), ${notificadasPorCorreo} notificada(s) por correo ===`);
  process.exit(0);
})().catch((err) => {
  console.error("Error en notificar-respuestas:", err);
  process.exit(1);
});

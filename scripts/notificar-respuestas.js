// Notifica a info@qi-vanta.com cada vez que alguien contesta un correo,
// de CUALQUIER campaña (Google Maps, Piloto LATAM, Alianzas, y cualquier
// otra que se agregue después) — pedido explícito del usuario el
// 2026-09-22: "de cualquier campaña si alguien contesta un correo
// recuerda enviarlo a la cuenta de info@qi-vanta.com... desde también el
// buzón maestro de smartlead". Usa el buzón maestro de Smartlead (una
// sola llamada para todas las campañas) en vez de revisar cada campaña
// por separado.
//
// Corre como script directo (no endpoint de Vercel) — el plan Hobby ya
// está en el tope de 12 funciones serverless, agregar una más lo hubiera
// pasado. Mismo patrón que validar-integridad.js/sincronizar-aperturas.js.
//
// Dedup real contra Mongo (colección "respuestasNotificadas", clave
// email_lead_map_id) — sin esto, cada corrida volvería a notificar TODAS
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

(async () => {
  const db = await getDb();
  const col = db.collection("respuestasNotificadas");

  const respuestas = await obtenerRespuestasMasterInbox();
  console.log(`Respuestas totales en el buzón maestro: ${respuestas.length}`);

  let nuevas = 0;
  for (const r of respuestas) {
    const yaNotificada = await col.findOne({ _id: r.email_lead_map_id });
    if (yaNotificada) continue;

    const nombre = [r.lead_first_name, r.lead_last_name].filter(Boolean).join(" ") || r.lead_email;
    console.log(`Nueva respuesta: ${nombre} <${r.lead_email}> — ${r.email_campaign_name}`);

    if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
      await enviarCorreoInterno({
        asunto: `Nueva respuesta: ${nombre} (${r.email_campaign_name})`,
        texto: [
          `Campaña: ${r.email_campaign_name}`,
          `Lead: ${nombre} <${r.lead_email}>`,
          `Última vez que se le mandó correo: ${r.last_sent_time}`,
          `Hora de la respuesta: ${r.last_reply_time}`,
          ``,
          `Revisa el contenido completo en el buzón maestro de Smartlead (server.smartlead.ai) o pídele a Claude "muéstrame esta respuesta".`,
        ].join("\n"),
      });
    }

    await col.updateOne({ _id: r.email_lead_map_id }, { $set: { ...r, notificadoEn: new Date() } }, { upsert: true });
    nuevas++;
  }

  console.log(`=== ${nuevas} respuesta(s) nueva(s) notificada(s) a info@qi-vanta.com ===`);
  process.exit(0);
})().catch((err) => {
  console.error("Error en notificar-respuestas:", err);
  process.exit(1);
});

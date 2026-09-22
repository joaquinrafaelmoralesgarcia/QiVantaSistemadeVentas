// Agrega un lead a una campaña de Smartlead para que el correo frío salga
// rotando entre las 6 cuentas de workspace ya configuradas ahí. Usado por
// el flujo de Google Maps (_leadsProcessor.js, campaña por default
// SMARTLEAD_CAMPAIGN_ID = "Qi-Vanta | Apify Google Maps", id 3890342) y
// desde el 2026-09-07 también por el flujo de Piloto LATAM
// (_leadsProcessorEmpresa.js, pasando campaignId=SMARTLEAD_CAMPAIGN_ID_LATAM
// explícitamente).
// Verificado con la cuenta real el 2026-09-02: la secuencia de esa campaña
// usa los merge tags {{qi_vanta_subject}}/{{qi_vanta_message}} (y desde el
// 2026-09-05, {{qi_vanta_followup1}}/{{qi_vanta_followup2}} en los pasos 2
// y 3 de la secuencia) en vez de los campos estándar de Smartlead — hay
// que mandarlos como custom_fields con esos nombres exactos o el correo
// sale vacío.
const SMARTLEAD_BASE_URL = "https://server.smartlead.ai/api/v1";

async function agregarLeadACampania({ nombre, correo, empresa, telefono, customFields, campaignId }) {
  const apiKey = process.env.SMARTLEAD_API_KEY;
  const idCampania = campaignId || process.env.SMARTLEAD_CAMPAIGN_ID;

  if (!apiKey || !idCampania) {
    throw new Error("Falta configurar SMARTLEAD_API_KEY y/o SMARTLEAD_CAMPAIGN_ID.");
  }

  const url = `${SMARTLEAD_BASE_URL}/campaigns/${idCampania}/leads?api_key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lead_list: [
        {
          first_name: nombre || "",
          email: correo,
          company_name: empresa || "",
          phone_number: telefono || "",
          custom_fields: customFields || {},
        },
      ],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Smartlead respondió con error (${res.status}): ${errBody}`);
  }

  return res.json();
}

// Ajusta cuántos leads nuevos al día puede mandar una campaña — pedido
// explícito del usuario el 2026-09-09: "al acabarse los creditos de
// apollo, sube el nivel de envios de campaña de google maps... para
// llenar los 40 envios por cada cuenta de correo... cada vez que se me
// acaben los creditos de apollo". Las 6 cuentas son compartidas entre
// Google Maps y Piloto LATAM (6 × 40/día = 240 de cupo total); cuando
// Piloto LATAM no tiene nada nuevo que mandar ese día, Google Maps puede
// usar el cupo completo sin que se desperdicie.
//
// Verificado el 2026-09-09 contra la API real: el endpoint exige mandar
// TODOS los campos del horario juntos (no solo el que cambia), o
// responde 400 pidiendo el campo faltante uno por uno. Por eso primero
// se lee el horario actual y se reenvía completo, solo cambiando
// max_new_leads_per_day.
async function actualizarTopeCampania(campaignId, maxNuevosLeadsPorDia) {
  const apiKey = process.env.SMARTLEAD_API_KEY;
  const actual = await fetch(`${SMARTLEAD_BASE_URL}/campaigns/${campaignId}?api_key=${encodeURIComponent(apiKey)}`).then((r) => r.json());

  if (actual.max_leads_per_day === maxNuevosLeadsPorDia) {
    return { sinCambio: true, topeActual: actual.max_leads_per_day };
  }

  const horario = actual.scheduler_cron_value || {};
  const res = await fetch(`${SMARTLEAD_BASE_URL}/campaigns/${campaignId}/schedule?api_key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      timezone: horario.tz || "America/Mexico_City",
      days_of_the_week: horario.days || [1, 2, 3, 4, 5, 6],
      start_hour: horario.startHour || "08:00",
      end_hour: horario.endHour || "10:00",
      min_time_btw_emails: actual.min_time_btwn_emails || 4,
      max_new_leads_per_day: maxNuevosLeadsPorDia,
    }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`No se pudo actualizar el tope de la campaña ${campaignId} (${res.status}): ${errBody}`);
  }
  return { sinCambio: false, topeAnterior: actual.max_leads_per_day, topeNuevo: maxNuevosLeadsPorDia };
}

// Descarga TODOS los leads de una campaña con su status real (COMPLETED,
// INPROGRESS, STARTED, BLOCKED), lead_category_id (no-null = se marcó
// como interesado/no interesado/otro) e is_unsubscribed — usado por el
// reciclaje para confirmar, antes de volver a escribirle a alguien, que
// de verdad no respondió y no se dio de baja. Nunca reciclar solo con el
// estado guardado en Mongo, que no refleja respuestas/bajas reales de
// Smartlead — pedido explícito del usuario el 2026-09-10 (aunque no lo
// pidió con esas palabras, es la única forma segura de no volver a
// contactar a alguien que ya dijo que no le interesa).
async function obtenerEstadosDeCampania(campaignId) {
  const apiKey = process.env.SMARTLEAD_API_KEY;
  const porCorreo = new Map();
  let offset = 0;
  const limit = 100;
  while (true) {
    const res = await fetch(`${SMARTLEAD_BASE_URL}/campaigns/${campaignId}/leads?api_key=${encodeURIComponent(apiKey)}&offset=${offset}&limit=${limit}`);
    const data = await res.json();
    const pagina = data.data || [];
    for (const item of pagina) {
      const correo = item.lead?.email?.toLowerCase();
      if (!correo) continue;
      porCorreo.set(correo, {
        leadId: item.lead.id,
        status: item.status,
        leadCategoryId: item.lead_category_id,
        isUnsubscribed: Boolean(item.lead.is_unsubscribed),
      });
    }
    if (pagina.length < limit) break;
    offset += limit;
  }
  return porCorreo;
}

// Quita un lead de una campaña — pedido explícito del usuario el
// 2026-09-10: cuando se acaben los créditos de Apollo, reciclar leads
// viejos ofreciéndoles un servicio distinto. Smartlead no tiene forma de
// "reiniciar" la secuencia de un lead ya COMPLETED — borrarlo y volver a
// agregarlo (con agregarLeadACampania) sí genera un mapeo nuevo, que
// arranca la secuencia desde el paso 1 con el contenido nuevo. Confirmado
// que el endpoint existe probando con un lead_id inválido (200, {"ok":
// false}, sin tocar datos reales) antes de usarlo en un lead real.
async function eliminarLeadDeCampania(campaignId, leadId) {
  const apiKey = process.env.SMARTLEAD_API_KEY;
  const res = await fetch(`${SMARTLEAD_BASE_URL}/campaigns/${campaignId}/leads/${leadId}?api_key=${encodeURIComponent(apiKey)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`No se pudo borrar el lead ${leadId} de la campaña ${campaignId} (${res.status}): ${errBody}`);
  }
  return res.json();
}

// Pausa/reactiva una campaña completa — pedido explícito del usuario el
// 2026-09-13: no mandar correo en días festivos oficiales de México
// (LFT). Verificado en real contra la API (pausa y reactiva de inmediato,
// sin dejar la campaña real pausada): POST .../status con
// {status:"PAUSED"} pausa, {status:"START"} reactiva a ACTIVE.
async function actualizarEstadoCampania(campaignId, status) {
  const apiKey = process.env.SMARTLEAD_API_KEY;
  const res = await fetch(`${SMARTLEAD_BASE_URL}/campaigns/${campaignId}/status?api_key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`No se pudo cambiar el estado de la campaña ${campaignId} a ${status} (${res.status}): ${errBody}`);
  }
  return res.json();
}

async function obtenerEstadoRealCampania(campaignId) {
  const apiKey = process.env.SMARTLEAD_API_KEY;
  const res = await fetch(`${SMARTLEAD_BASE_URL}/campaigns/${campaignId}?api_key=${encodeURIComponent(apiKey)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(`No se pudo consultar el estado de la campaña ${campaignId} (${res.status}): ${JSON.stringify(data)}`);
  return data.status;
}

// Buzón maestro de Smartlead — junta las respuestas de TODAS las
// campañas en una sola llamada (a diferencia de recorrer
// /campaigns/{id}/statistics campaña por campaña). Pedido explícito del
// usuario el 2026-09-22: "de cualquier campaña si alguien contesta un
// correo recuerda enviarlo a la cuenta de info@qi-vanta.com... desde
// también el buzón maestro de smartlead". Paginado — devuelve TODAS las
// respuestas encontradas, sin importar la campaña.
async function obtenerRespuestasMasterInbox() {
  const apiKey = process.env.SMARTLEAD_API_KEY;
  const respuestas = [];
  let offset = 0;
  const limit = 20; // máximo que acepta este endpoint
  while (true) {
    const res = await fetch(`${SMARTLEAD_BASE_URL}/master-inbox/inbox-replies?api_key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offset, limit }),
    });
    if (!res.ok) throw new Error(`No se pudo consultar el buzón maestro de Smartlead (${res.status})`);
    const data = await res.json();
    const pagina = data.data || [];
    respuestas.push(...pagina);
    if (pagina.length < limit) break;
    offset += limit;
    if (offset > 2000) break; // límite de seguridad, no debería haber tantas respuestas
  }
  return respuestas;
}

module.exports = { agregarLeadACampania, actualizarTopeCampania, obtenerEstadosDeCampania, eliminarLeadDeCampania, actualizarEstadoCampania, obtenerEstadoRealCampania, obtenerRespuestasMasterInbox };

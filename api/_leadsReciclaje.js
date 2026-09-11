// Reciclaje de leads viejos de Piloto LATAM cuando Apollo Y Hunter se
// quedan sin nada nuevo que dar ese día — pedido explícito del usuario el
// 2026-09-10: "cuando se termines mis creditos para buscar mas leads en
// apollo cda mes, deberas enviar correos de nuevo a todos los leads que
// tenemos guardados en mongo... desde los leads mas viejos a los nuevos,
// pero esta vez el titulo y el contenido debe ofrecer algo de nuestros
// servicios diferente a los que se hayan mandado a ese lead". Solo aplica
// a Piloto LATAM (confirmado explícitamente con el usuario el
// 2026-09-10) — Google Maps sigue teniendo ciudades/giros nuevos que
// explorar vía Apify, no necesita reciclar.
const { generarScriptEmpresa } = require("./_leadScript");
const { catalogoPara } = require("./_prospectingPromptEnterprise");
const { agregarLeadACampania, obtenerEstadosDeCampania, eliminarLeadDeCampania } = require("./_smartlead");

const ORIGENES_LATAM = ["apollo_latam", "hunter_latam", "clay_latam", "snov_latam", "lusha_latam", "kaspr_latam", "importacion_manual", "smartlead_existente"];

// LLM de por lead (generarScriptEmpresa) es el costo real por corrida —
// mismo aprendizaje que el scrapeo de Apollo (2026-09-10): tope bajo aquí,
// no en la consulta a Mongo, para no repetir el timeout de Vercel.
const LOTE_RECICLAJE = 5;
// Candidatos a revisar por corrida (más que LOTE_RECICLAJE porque muchos
// se descartan al cruzarlos con el estado real de Smartlead — respondió,
// se dio de baja, o aún no completó su secuencia).
const CANDIDATOS_A_REVISAR = 40;

async function reciclarLeadsAntiguos(db) {
  const campaignId = process.env.SMARTLEAD_CAMPAIGN_ID_LATAM;
  const leadsCol = db.collection("leads");

  const candidatos = await leadsCol
    .find({
      origen: { $in: ORIGENES_LATAM },
      emailEstado: "enviado_a_campana",
      correo: { $type: "string", $ne: "" },
      catalogoAgotado: { $ne: true },
      excluidoDeReciclaje: { $ne: true },
    })
    .sort({ createdAt: 1 })
    .limit(CANDIDATOS_A_REVISAR)
    .toArray();

  if (!candidatos.length) {
    return { sinCandidatos: true, reciclados: 0, excluidos: 0, catalogoAgotado: 0, revisados: 0 };
  }

  // Un solo pull del estado real de la campaña (todas las páginas) en vez
  // de una consulta por candidato — más barato y evita golpear el rate
  // limit de Smartlead con hasta 40 llamadas sueltas.
  const estadosReales = await obtenerEstadosDeCampania(campaignId);

  let reciclados = 0;
  let excluidos = 0;
  let catalogoAgotado = 0;
  let revisados = 0;

  for (const lead of candidatos) {
    if (reciclados >= LOTE_RECICLAJE) break;
    revisados++;

    const real = estadosReales.get(lead.correo.toLowerCase());

    // Exclusión PERMANENTE solo para señales terminales de verdad: se dio
    // de baja, alguien le puso una categoría (interesado/no interesado/
    // etc — lead_category_id no-null), o rebotó/bloqueado. Nunca marcar
    // esto para "todavía no terminó su secuencia" (STARTED/INPROGRESS) —
    // ese es un estado TEMPORAL, el lead sí debe reconsiderarse en una
    // corrida futura una vez que complete su secuencia sin responder. Bug
    // real encontrado probando esto el 2026-09-10: la primera versión
    // marcaba INPROGRESS como exclusión permanente, dejando a esos leads
    // fuera del reciclaje para siempre aunque después sí completaran.
    if (real?.isUnsubscribed || real?.leadCategoryId !== null && real?.leadCategoryId !== undefined || real?.status === "BLOCKED") {
      const motivo = real.isUnsubscribed ? "unsubscribed" : real.leadCategoryId !== null ? "categorizado" : "blocked";
      await leadsCol.updateOne({ _id: lead._id }, { $set: { excluidoDeReciclaje: true, motivoExclusionReciclaje: motivo } });
      excluidos++;
      continue;
    }

    // No encontrado, o encontrado pero aún no completó (STARTED/
    // INPROGRESS) — se salta esta corrida SIN marcar exclusión permanente.
    if (!real || real.status !== "COMPLETED") {
      excluidos++;
      continue;
    }

    const catalogo = catalogoPara(lead.numEmpleados);
    const ofertasUsadas = Array.isArray(lead.ofertasEnviadas) ? lead.ofertasEnviadas : lead.oferta ? [lead.oferta] : [];
    const ofertasDisponibles = catalogo.filter((o) => !ofertasUsadas.includes(o.id));
    if (!ofertasDisponibles.length) {
      await leadsCol.updateOne({ _id: lead._id }, { $set: { catalogoAgotado: true } });
      catalogoAgotado++;
      continue;
    }

    const script = await generarScriptEmpresa({
      nombre: lead.nombre,
      titulo: lead.titulo,
      empresa: lead.empresa,
      numEmpleados: lead.numEmpleados,
      descripcionEmpresa: lead.descripcionEmpresa,
      ofertasExcluidas: ofertasUsadas,
      esReciclaje: true,
    }).catch((err) => {
      console.error("Error generando script de reciclaje para", lead.correo, err.message);
      return null;
    });
    if (!script) continue;

    try {
      await eliminarLeadDeCampania(campaignId, real.leadId);
      await agregarLeadACampania({
        nombre: lead.nombre,
        correo: lead.correo,
        empresa: lead.empresa,
        telefono: "",
        campaignId,
        customFields: {
          qi_vanta_subject: script.asuntoEmail,
          qi_vanta_message: script.cuerpoEmail,
          qi_vanta_followup1_subject: script.seguimiento1Asunto,
          qi_vanta_followup1: script.seguimiento1,
          qi_vanta_followup2_subject: script.seguimiento2Asunto,
          qi_vanta_followup2: script.seguimiento2,
        },
      });

      await leadsCol.updateOne(
        { _id: lead._id },
        {
          $set: {
            asuntoEmail: script.asuntoEmail,
            cuerpoEmail: script.cuerpoEmail,
            seguimiento1Asunto: script.seguimiento1Asunto,
            seguimiento1: script.seguimiento1,
            seguimiento2Asunto: script.seguimiento2Asunto,
            seguimiento2: script.seguimiento2,
            oferta: script.oferta,
            ultimoReciclajeAt: new Date(),
          },
          $push: {
            ofertasEnviadas: script.oferta,
            historialReciclaje: { fecha: new Date(), oferta: script.oferta, asuntoEmail: script.asuntoEmail },
          },
          $inc: { vecesReciclado: 1 },
        }
      );
      reciclados++;
    } catch (err) {
      console.error("Error reciclando lead", lead.correo, err.message);
    }
  }

  return { sinCandidatos: false, revisados, reciclados, excluidos, catalogoAgotado };
}

module.exports = { reciclarLeadsAntiguos, ORIGENES_LATAM };

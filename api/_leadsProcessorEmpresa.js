const { generarScriptEmpresa } = require("./_leadScript");
const { agregarLeadACampania } = require("./_smartlead");
const { correoTieneServidorValido } = require("./_emailVerify");
const { revelarCorreo } = require("./_apollo");

// Espejo de _leadsProcessor.js (Google Maps) pero para el pipeline de
// Piloto LATAM vía Apollo — pedido explícito del usuario el 2026-09-07:
// "en apollo debe obtenerse nuevos contactos diario, latam, todo tipo de
// empresa, 150 diarios" y "no hay que sacar ningún teléfono solo correos".
//
// Diferencia clave frente a Google Maps: Apollo cobra 1 crédito por cada
// candidato que se "revela" (revelarCorreo), incluso si ya se había
// revelado antes en un día anterior — por eso el dedup aquí es ANTES de
// revelar (por apolloId, nunca por correo, porque el correo real no se
// conoce hasta después de gastar el crédito).
//
// Si Apollo devuelve BILLING.LIMIT.CREDITS_EXHAUSTED, se detiene de
// inmediato (no tiene caso seguir intentando el resto de la página, todos
// fallarían igual) y lo reporta en detenidoPorErrores para que el cron no
// avance el cursor de página — mañana se reintenta la misma página.
async function procesarPersonasApollo(coleccion, personas) {
  const ids = personas.map((p) => p.id);
  const existentes = await coleccion
    .find({ apolloId: { $in: ids } })
    .project({ apolloId: 1 })
    .toArray();
  const idsExistentes = new Set(existentes.map((e) => e.apolloId));
  const nuevas = personas.filter((p) => !idsExistentes.has(p.id));

  const leads = [];
  let revelados = 0;
  let sinCorreoApollo = 0;
  let correosInvalidos = 0;
  let correosEnviados = 0;
  let erroresCorreo = 0;

  for (const persona of nuevas) {
    let revelado;
    try {
      revelado = await revelarCorreo(persona.id);
    } catch (err) {
      if (err.apolloCode === "BILLING.LIMIT.CREDITS_EXHAUSTED") {
        if (leads.length) await coleccion.insertMany(leads);
        return {
          totalCandidatos: personas.length,
          yaExistian: personas.length - nuevas.length,
          intentados: leads.length,
          revelados,
          sinCorreoApollo,
          correosInvalidos,
          correosEnviados,
          erroresCorreo,
          detenidoPorErrores: true,
          motivoDetencion: "Sin créditos de Apollo disponibles (BILLING.LIMIT.CREDITS_EXHAUSTED).",
        };
      }
      console.error("Error revelando candidato de Apollo", persona.id, err.message);
      leads.push({ apolloId: persona.id, origen: "apollo_latam", estado: "error_apollo", errorApollo: err.message, createdAt: new Date() });
      continue;
    }

    if (!revelado || !revelado.correo) {
      sinCorreoApollo++;
      leads.push({ apolloId: persona.id, origen: "apollo_latam", estado: "sin_correo_apollo", createdAt: new Date() });
      continue;
    }
    revelados++;

    const valido = await correoTieneServidorValido(revelado.correo);
    if (!valido) {
      correosInvalidos++;
      leads.push({
        apolloId: persona.id,
        origen: "apollo_latam",
        nombre: revelado.nombre,
        empresa: revelado.empresa,
        correoInvalido: revelado.correo,
        estado: "correo_invalido",
        createdAt: new Date(),
      });
      continue;
    }

    const script = await generarScriptEmpresa(revelado).catch((err) => {
      console.error("Error generando script para", revelado.nombre, err);
      return null;
    });

    const lead = {
      apolloId: persona.id,
      origen: "apollo_latam",
      nombre: revelado.nombre,
      titulo: revelado.titulo,
      empresa: revelado.empresa,
      correo: revelado.correo,
      calificacion: script?.calificacion || null,
      razonamiento: script?.razonamiento || "",
      oferta: script?.oferta || "",
      asuntoEmail: script?.asuntoEmail || `Automatización e IA para ${revelado.empresa}`,
      cuerpoEmail: script?.cuerpoEmail || "",
      seguimiento1: script?.seguimiento1 || "",
      seguimiento2: script?.seguimiento2 || "",
      estado: "nuevo",
      emailEstado: null,
      createdAt: new Date(),
    };

    try {
      await agregarLeadACampania({
        nombre: revelado.nombre,
        correo: revelado.correo,
        empresa: revelado.empresa,
        telefono: "",
        campaignId: process.env.SMARTLEAD_CAMPAIGN_ID_LATAM,
        customFields: {
          qi_vanta_subject: lead.asuntoEmail,
          qi_vanta_message: lead.cuerpoEmail,
          qi_vanta_followup1: lead.seguimiento1,
          qi_vanta_followup2: lead.seguimiento2,
        },
      });
      lead.emailEstado = "enviado_a_campana";
      correosEnviados++;
    } catch (err) {
      console.error("Error mandando a Smartlead (LATAM):", revelado.nombre, err.message);
      lead.emailEstado = "error";
      lead.emailError = err.message;
      erroresCorreo++;
    }

    leads.push(lead);
  }

  if (leads.length) await coleccion.insertMany(leads);

  return {
    totalCandidatos: personas.length,
    yaExistian: personas.length - nuevas.length,
    intentados: nuevas.length,
    revelados,
    sinCorreoApollo,
    correosInvalidos,
    correosEnviados,
    erroresCorreo,
    detenidoPorErrores: false,
  };
}

module.exports = { procesarPersonasApollo };

const { generarScriptEmpresa } = require("./_leadScript");
const { generarCorreoAlianza } = require("./_alianzasScript");
const { agregarLeadACampania } = require("./_smartlead");
const { correoTieneServidorValido } = require("./_emailVerify");
const { esEmpresaNoContactar } = require("./_empresaGrande");

// Paso compartido por las 3 fuentes de contactos de Piloto LATAM (Apollo,
// Hunter, e importación manual de Clay/Snov.io/Lusha/Kaspr) — agregado el
// 2026-09-07 al detectar que el mismo bloque (validar MX, generar el
// correo con generarScriptEmpresa, mandar a Smartlead, guardar en Mongo)
// se repetía en cada fuente. Requiere que "persona" ya traiga el correo
// REAL — revelar/encontrar ese correo es responsabilidad de cada fuente
// antes de llamar esto, no de esta función.
async function procesarPersonaEmpresa(leadsCol, persona, origen, camposExtra = {}) {
  const campaignId = camposExtra.campaignId || process.env.SMARTLEAD_CAMPAIGN_ID_LATAM;
  const campaignKey = camposExtra.campaignKey || "piloto_latam";
  const campaignName = camposExtra.campaignName || "Qi-Vanta | Piloto LATAM | Decisores";
  const empresaBloqueada = esEmpresaNoContactar({ nombre: persona.empresa, empresa: persona.empresa, sitioWeb: persona.sitioWeb, correo: persona.correo });
  if (empresaBloqueada) {
    await leadsCol.insertOne({
      origen,
      ...camposExtra,
      nombre: persona.nombre,
      empresa: persona.empresa,
      correo: persona.correo,
      campaignId,
      campaignKey,
      campaignName,
      estado: "bloqueado_no_contactar",
      motivoBloqueo: empresaBloqueada,
      createdAt: new Date(),
    });
    return { resultado: "bloqueado_no_contactar" };
  }
  const existe = await leadsCol.findOne({ correo: persona.correo });
  if (existe) return { resultado: "ya_existia" };

  const valido = await correoTieneServidorValido(persona.correo);
  if (!valido) {
    await leadsCol.insertOne({
      origen,
      ...camposExtra,
      nombre: persona.nombre,
      empresa: persona.empresa,
      correoInvalido: persona.correo,
      campaignId,
      campaignKey,
      campaignName,
      estado: "correo_invalido",
      createdAt: new Date(),
    });
    return { resultado: "correo_invalido" };
  }

  const crearScript = campaignKey === "alianzas" ? generarCorreoAlianza : generarScriptEmpresa;
  const script = await Promise.resolve(crearScript(persona)).catch((err) => {
    console.error("Error generando script para", persona.nombre, err);
    return null;
  });

  const lead = {
    origen,
    ...camposExtra,
    nombre: persona.nombre,
    titulo: persona.titulo || "",
    empresa: persona.empresa,
    correo: persona.correo,
    sitioWeb: persona.sitioWeb || null,
    numEmpleados: typeof persona.numEmpleados === "number" ? persona.numEmpleados : null,
    calificacion: script?.calificacion || null,
    razonamiento: script?.razonamiento || "",
    oferta: script?.oferta || "",
    asuntoEmail: script?.asuntoEmail || `Automatización e IA para ${persona.empresa || persona.nombre}`,
    cuerpoEmail: script?.cuerpoEmail || "",
    seguimiento1Asunto: script?.seguimiento1Asunto || "",
    seguimiento1: script?.seguimiento1 || "",
    seguimiento2Asunto: script?.seguimiento2Asunto || "",
    seguimiento2: script?.seguimiento2 || "",
    estado: "nuevo",
    emailEstado: null,
    campaignId,
    campaignKey,
    campaignName,
    createdAt: new Date(),
  };

  try {
    await agregarLeadACampania({
      nombre: persona.nombre,
      correo: persona.correo,
      empresa: persona.empresa,
      telefono: "",
      campaignId,
      customFields: {
        qi_vanta_subject: lead.asuntoEmail,
        qi_vanta_message: lead.cuerpoEmail,
        qi_vanta_followup1_subject: lead.seguimiento1Asunto,
        qi_vanta_followup1: lead.seguimiento1,
        qi_vanta_followup2_subject: lead.seguimiento2Asunto,
        qi_vanta_followup2: lead.seguimiento2,
      },
    });
    lead.emailEstado = "enviado_a_campana";
  } catch (err) {
    console.error("Error mandando a Smartlead:", persona.nombre, err.message);
    lead.emailEstado = "error";
    lead.emailError = err.message;
  }

  await leadsCol.insertOne(lead);
  return { resultado: lead.emailEstado === "enviado_a_campana" ? "enviado" : "error_smartlead" };
}

module.exports = { procesarPersonaEmpresa };

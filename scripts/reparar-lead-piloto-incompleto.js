// Repara un lead de Piloto LATAM cuyos merge fields de Smartlead quedaron
// incompletos. Corre con: node scripts/reparar-lead-piloto-incompleto.js
// No expone secretos ni datos de las cuentas de envío.
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

const CAMPAIGN_ID = "3842244";
const EMAIL = "r.mendoza@norjal.com";
const SMARTLEAD_BASE = "https://server.smartlead.ai/api/v1";

function cargarEntorno() {
  const archivo = path.join(__dirname, "..", ".env.local");
  for (const linea of fs.readFileSync(archivo, "utf8").split(/\r?\n/)) {
    const match = linea.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}

async function obtenerLeadSmartlead(apiKey) {
  for (let offset = 0; ; offset += 100) {
    const url = `${SMARTLEAD_BASE}/campaigns/${CAMPAIGN_ID}/leads?api_key=${encodeURIComponent(apiKey)}&offset=${offset}&limit=100`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`No se pudo consultar Smartlead (${res.status}).`);
    const pagina = (await res.json()).data || [];
    const encontrado = pagina.find((item) => item.lead?.email?.toLowerCase() === EMAIL);
    if (encontrado) return encontrado;
    if (pagina.length < 100) return null;
  }
}

function contenidoRespaldo(empresa) {
  const nombreEmpresa = empresa || "su empresa";
  return {
    asuntoEmail: "Donde hay repetición, hay ahorro posible",
    cuerpoEmail: `En ${nombreEmpresa}, los procesos repetitivos de operación, seguimiento y reporte pueden terminar costando dinero cada mes sin que sea evidente.\n\nEn Qi-Vanta identificamos esos puntos y construimos automatizaciones y asistentes de IA que se conectan con las herramientas que ya utilizan, sin obligarlos a reemplazar todo.\n\nPodemos preparar sin costo un diagnóstico inicial con oportunidades concretas de ahorro y un posible piloto de bajo riesgo. ¿Te parece si revisamos qué proceso tendría más impacto primero?`,
    seguimiento1Asunto: "Una forma práctica de encontrar el ahorro operativo",
    seguimiento1: "Retomo el mensaje porque muchas oportunidades de ahorro no aparecen en un reporte financiero: viven en capturas manuales, seguimiento de correos y decisiones que dependen de buscar datos en varios sistemas. Podemos revisar uno de esos procesos y devolverles un diagnóstico inicial, sin compromiso. ¿Hay alguna operación que hoy les esté consumiendo más tiempo del que debería?",
    seguimiento2Asunto: "Cierro el tema por ahora",
    seguimiento2: "Este es mi último mensaje por ahora. Si más adelante quieren ubicar un proceso donde la IA pueda reducir trabajo manual y costo operativo sin un proyecto grande de inicio, con gusto preparamos un assessment breve y accionable para su equipo.",
  };
}

async function main() {
  cargarEntorno();
  const { MONGODB_URI, MONGODB_DB = "qivanta_chatbot", SMARTLEAD_API_KEY } = process.env;
  if (!MONGODB_URI || !SMARTLEAD_API_KEY) throw new Error("Faltan MONGODB_URI o SMARTLEAD_API_KEY.");

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  try {
    const leads = client.db(MONGODB_DB).collection("leads");
    const mongoLead = await leads.findOne({ correo: EMAIL });
    if (!mongoLead) throw new Error("El lead no existe en Mongo.");

    const smartleadLead = await obtenerLeadSmartlead(SMARTLEAD_API_KEY);
    if (!smartleadLead?.lead?.id) throw new Error("El lead no existe en la campaña de Smartlead.");

    const respaldo = contenidoRespaldo(mongoLead.empresa);
    const datos = {
      asuntoEmail: mongoLead.asuntoEmail || respaldo.asuntoEmail,
      cuerpoEmail: mongoLead.cuerpoEmail || respaldo.cuerpoEmail,
      seguimiento1Asunto: mongoLead.seguimiento1Asunto || respaldo.seguimiento1Asunto,
      seguimiento1: mongoLead.seguimiento1 || respaldo.seguimiento1,
      seguimiento2Asunto: mongoLead.seguimiento2Asunto || respaldo.seguimiento2Asunto,
      seguimiento2: mongoLead.seguimiento2 || respaldo.seguimiento2,
    };
    const customFields = {
      ...(smartleadLead.lead.custom_fields || {}),
      qi_vanta_subject: datos.asuntoEmail,
      qi_vanta_message: datos.cuerpoEmail,
      qi_vanta_followup1_subject: datos.seguimiento1Asunto,
      qi_vanta_followup1: datos.seguimiento1,
      qi_vanta_followup2_subject: datos.seguimiento2Asunto,
      qi_vanta_followup2: datos.seguimiento2,
    };
    const url = `${SMARTLEAD_BASE}/campaigns/${CAMPAIGN_ID}/leads/${smartleadLead.lead.id}?api_key=${encodeURIComponent(SMARTLEAD_API_KEY)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: EMAIL,
        first_name: smartleadLead.lead.first_name || mongoLead.nombre || "",
        last_name: smartleadLead.lead.last_name || "",
        company_name: smartleadLead.lead.company_name || mongoLead.empresa || "",
        custom_fields: customFields,
      }),
    });
    if (!res.ok) throw new Error(`Smartlead rechazó la reparación (${res.status}).`);

    await leads.updateOne(
      { _id: mongoLead._id },
      { $set: { ...datos, emailEstado: "enviado_a_campana", reparadoMergeFieldsAt: new Date() } },
    );
    console.log(JSON.stringify({ reparado: true, campaignId: CAMPAIGN_ID, smartleadLeadId: smartleadLead.lead.id }));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

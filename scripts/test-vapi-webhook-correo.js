// Prueba local: simula un end-of-call-report de Vapi para una llamada del
// botón "¡Llámame!" y confirma que se arma el correo correcto — SIN enviarlo
// de verdad (intercepta _mailer y _mongo con stubs). Correr con:
//   node scripts/test-vapi-webhook-correo.js
process.env.GMAIL_USER = "test@example.com";
process.env.GMAIL_APP_PASSWORD = "test";

const path = require("path");
const mailerPath = require.resolve("../api/_mailer");
const mongoPath = require.resolve("../api/_mongo");

let correoEnviado = null;
require.cache[mailerPath] = {
  id: mailerPath,
  filename: mailerPath,
  loaded: true,
  exports: {
    enviarCorreoInterno: async (args) => {
      correoEnviado = args;
    },
  },
};

const dbStub = {
  collection() {
    return {
      updateOne: async () => {},
      findOne: async () => null,
      insertOne: async () => {},
    };
  },
};
require.cache[mongoPath] = {
  id: mongoPath,
  filename: mongoPath,
  loaded: true,
  exports: { getDb: async () => dbStub },
};

const handler = require("../api/vapi-webhook");

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function main() {
  const req = {
    method: "POST",
    headers: {},
    body: {
      message: {
        type: "end-of-call-report",
        endedReason: "customer-ended-call",
        startedAt: "2026-10-10T18:00:00.000Z",
        endedAt: "2026-10-10T18:02:30.000Z",
        recordingUrl: "https://storage.vapi.ai/fake-recording.mp3",
        call: { id: "call_fake_123" },
        customer: { number: "+527206442283" },
        analysis: {
          summary: "Cliente pregunta por precios, se le explicó el plan básico.",
          structuredData: {
            nombre: "Juan Pérez",
            empresa: "Ferretería Juan",
            correo: "juan@ferreteria.mx",
            numEmpleados: "5",
            sector: "Retail",
            reto: "Quiere más clientes",
            interes: "bajo",
            citaAcordada: null,
          },
        },
        artifact: { transcript: "Agente: Hola...\nCliente: Hola, quiero saber precios..." },
      },
    },
  };

  const res = fakeRes();
  await handler(req, res);

  console.assert(res.statusCode === 200, "Debe responder 200");
  console.assert(correoEnviado !== null, "Debe armar y 'enviar' un correo (llamada del botón, sin filtro de interés)");
  console.assert(correoEnviado.asunto === "Llamada Qi-Vanta: +527206442283 (2m 30s)", `Asunto inesperado: ${correoEnviado.asunto}`);
  console.assert(correoEnviado.texto.includes("Duración: 2m 30s"), "Debe incluir duración");
  console.assert(correoEnviado.texto.includes("Motivo de fin de llamada: customer-ended-call"), "Debe incluir motivo de fin");
  console.assert(correoEnviado.texto.includes("Grabación: https://storage.vapi.ai/fake-recording.mp3"), "Debe incluir link de grabación");
  console.assert(correoEnviado.texto.includes("--- Transcripción completa ---"), "Debe incluir transcripción");

  console.log("OK — correo armado correctamente para llamada del botón Llámame (interés bajo, sin filtro):");
  console.log(JSON.stringify(correoEnviado, null, 2));
}

main().catch((err) => {
  console.error("FALLÓ la prueba:", err);
  process.exit(1);
});

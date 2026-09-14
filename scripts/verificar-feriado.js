// Pausa las campañas de Smartlead en días festivos oficiales de México
// (LFT) y las reactiva al día siguiente — pedido explícito del usuario el
// 2026-09-13: "los dias festivos en mexico no mandes correo ni llamadas
// de ninguna campaña". Las llamadas ya se bloquean directamente en
// api/vapi.js (dentroDeHorarioLlamadas) porque ese cron corre bajo
// nuestro control; el envío de correo lo controla Smartlead solo una vez
// que la campaña está ACTIVE, así que la única forma real de no mandar
// nada ese día es pausar la campaña completa antes de que empiece la
// ventana de envío y reactivarla después.
//
// Guarda en Mongo si NOSOTROS pausamos la campaña (no si el usuario la
// pausó manualmente por otra razón) — así el día siguiente solo
// reactivamos lo que nosotros mismos pausamos, nunca algo que el usuario
// haya detenido a propósito.
const fs = require("fs");
const path = require("path");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const { getDb } = require("../api/_mongo");
const { actualizarEstadoCampania, obtenerEstadoRealCampania } = require("../api/_smartlead");
const { esFestivoOficialMexico } = require("../api/_feriadosMexico");

const CAMPANIAS = [
  { nombre: "Google Maps", id: process.env.SMARTLEAD_CAMPAIGN_ID },
  { nombre: "Piloto LATAM", id: process.env.SMARTLEAD_CAMPAIGN_ID_LATAM },
];

async function procesarCampania(db, col, campania, esFestivoHoy) {
  const estadoGuardado = await col.findOne({ _id: campania.id });
  const estadoReal = await obtenerEstadoRealCampania(campania.id);

  if (esFestivoHoy) {
    if (estadoReal === "ACTIVE") {
      await actualizarEstadoCampania(campania.id, "PAUSED");
      await col.updateOne({ _id: campania.id }, { $set: { pausadaPorFeriado: true, pausadaEn: new Date() } }, { upsert: true });
      console.log(`${campania.nombre}: pausada por festivo (estaba ACTIVE).`);
    } else {
      console.log(`${campania.nombre}: ya estaba ${estadoReal}, no se toca (festivo).`);
    }
  } else {
    if (estadoGuardado?.pausadaPorFeriado && estadoReal === "PAUSED") {
      await actualizarEstadoCampania(campania.id, "START");
      await col.updateOne({ _id: campania.id }, { $set: { pausadaPorFeriado: false }, $unset: { pausadaEn: "" } });
      console.log(`${campania.nombre}: reactivada (la habíamos pausado nosotros por festivo).`);
    } else {
      console.log(`${campania.nombre}: sin cambios (estado real: ${estadoReal}, pausada por nosotros: ${Boolean(estadoGuardado?.pausadaPorFeriado)}).`);
    }
  }
}

(async () => {
  const hoyCdmx = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
  const esFestivoHoy = esFestivoOficialMexico(hoyCdmx);
  console.log(`Hoy (CDMX): ${hoyCdmx.toDateString()} — ¿festivo oficial LFT?: ${esFestivoHoy}`);

  const db = await getDb();
  const col = db.collection("estadoFeriadoCampanias");
  for (const campania of CAMPANIAS) {
    await procesarCampania(db, col, campania, esFestivoHoy);
  }
  process.exit(0);
})().catch((e) => {
  console.error("ERROR FATAL:", e.message);
  process.exit(1);
});

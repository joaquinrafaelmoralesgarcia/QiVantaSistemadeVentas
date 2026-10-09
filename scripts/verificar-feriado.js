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

// Las 4 campañas vigentes desde el 2026-10-07. Antes esta lista apuntaba a
// las 2 campañas viejas (SMARTLEAD_CAMPAIGN_ID / _LATAM), que ya están
// COMPLETED: las campañas que de verdad envían no quedaban protegidas en
// festivos (encontrado el 2026-10-09, pedido del usuario: "ejecutar las
// campañas y envíos de lunes a viernes y menos feriados").
const CAMPANIAS = [
  { nombre: "Piloto LATAM", id: "4093533" },
  { nombre: "Alianzas", id: "4093546" },
  { nombre: "Google Maps", id: "4093547" },
  { nombre: "Laboratorios", id: "4093548" },
];

// Hora (CDMX) en que cierra la ventana de envío de las campañas.
const CIERRE_VENTANA = 19;

// Fecha de la PRÓXIMA ventana de envío: hoy si todavía no cierra, mañana si
// ya cerró. Antes se miraba solo "hoy" con una corrida a las 7am CDMX, pero
// GitHub dispara los cron con ~6 horas de retraso (corridas reales: 12:46,
// 13:12 y 13:08 CDMX): en un festivo los correos habrían salido toda la
// mañana antes de pausar. Mirando la próxima ventana, una corrida de la
// noche anterior ya pausa a tiempo.
function fechaProximaVentana(ahoraCdmx) {
  const f = new Date(ahoraCdmx);
  if (ahoraCdmx.getHours() >= CIERRE_VENTANA) f.setDate(f.getDate() + 1);
  return f;
}

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
  const ahoraCdmx = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
  const ventana = fechaProximaVentana(ahoraCdmx);
  const esFestivoHoy = esFestivoOficialMexico(ventana);
  console.log(`Ahora (CDMX): ${ahoraCdmx.toString().slice(0, 21)} — próxima ventana: ${ventana.toDateString()} — ¿festivo oficial LFT?: ${esFestivoHoy}`);

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

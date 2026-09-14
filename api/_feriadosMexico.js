// Calendario de días no laborables oficiales de México (Ley Federal del
// Trabajo, Artículo 74) — pedido explícito del usuario el 2026-09-13: "los
// dias festivos en mexico no mandes correo ni llamadas de ninguna campaña
// ... igual para todos los dias no laborables por la lft de mexico". Se
// calcula por REGLA, no por fecha fija, para que siga funcionando en
// cualquier año sin tener que actualizar el código cada enero.
//
// "más adelante en otros países deberás verificar lo mismo" (pedido del
// mismo día) — pendiente, todavía no implementado para el resto de LatAm;
// por ahora Piloto LATAM sigue enviando correo normal fuera de México
// (las llamadas de Google Maps de por sí ya son exclusivas de México, ver
// _empresaGrande.js/vapi.js).
function nEsimoDiaSemanaDelMes(anio, mes, diaSemana, n) {
  // diaSemana: 0=domingo..6=sabado (igual que Date.getDay()). mes: 0-11.
  const primerDia = new Date(anio, mes, 1);
  const offset = (diaSemana - primerDia.getDay() + 7) % 7;
  const dia = 1 + offset + (n - 1) * 7;
  return new Date(anio, mes, dia);
}

function mismaFecha(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function feriadosOficialesDelAnio(anio) {
  return [
    new Date(anio, 0, 1), // Año Nuevo
    nEsimoDiaSemanaDelMes(anio, 1, 1, 1), // Primer lunes de febrero (Día de la Constitución)
    nEsimoDiaSemanaDelMes(anio, 2, 1, 3), // Tercer lunes de marzo (Natalicio de Benito Juárez)
    new Date(anio, 4, 1), // Día del Trabajo
    new Date(anio, 8, 16), // Día de la Independencia
    nEsimoDiaSemanaDelMes(anio, 10, 1, 3), // Tercer lunes de noviembre (Revolución Mexicana)
    new Date(anio, 11, 25), // Navidad
  ];
}

// Excepciones adicionales puntuales que NO son festivo oficial de LFT pero
// el usuario decidió tratar como no laborables (ej. tarde del 15 de
// septiembre por el Grito) — se agregan aquí a mano según se pidan, no se
// infieren automáticamente. "medioDiaDesde" en formato "HH:mm" 24h,
// hora CDMX: si se define, ese día NO es festivo completo, solo se
// bloquean llamadas/correo a partir de esa hora.
const EXCEPCIONES_PUNTUALES = [
  { fecha: new Date(2026, 8, 15), medioDiaDesde: "14:00" }, // pedido explícito 2026-09-13: lunes 14 normal, martes 15 medio día, miércoles 16 festivo oficial, jueves 17 normal
];

function esFestivoOficialMexico(fecha) {
  return feriadosOficialesDelAnio(fecha.getFullYear()).some((f) => mismaFecha(f, fecha));
}

// Devuelve { festivoCompleto, medioDiaDesde } para una fecha/hora dada (ya
// en hora CDMX) — combina festivos oficiales LFT + excepciones puntuales.
function estadoFeriado(fechaCdmx) {
  if (esFestivoOficialMexico(fechaCdmx)) return { festivoCompleto: true, medioDiaDesde: null };
  const excepcion = EXCEPCIONES_PUNTUALES.find((e) => mismaFecha(e.fecha, fechaCdmx));
  if (excepcion) return { festivoCompleto: false, medioDiaDesde: excepcion.medioDiaDesde };
  return { festivoCompleto: false, medioDiaDesde: null };
}

module.exports = { esFestivoOficialMexico, estadoFeriado, feriadosOficialesDelAnio };

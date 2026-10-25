// Universo de rubros y ubicaciones para el scrapeo diario automático
// (api/cron-scrape-start.js). Cubre cualquier tipo de negocio en
// cualquier ciudad/estado de México, rotando combinaciones al azar
// cada día para dar cobertura amplia con el tiempo.
// Reenfocado el 2026-09-15 — pedido explícito del usuario: "quita del
// scrapeo la busqueda de todos los negocios que hoy buscan, ahora solo
// nos enfocaremos en clinicas, consultorios, hospitales medianos o
// pequeños, escuelas, consultorios dentales, o clinicas o consultorios
// de cualquier tipo o especialidad". Reemplaza por completo la lista
// anterior (96 rubros de todo tipo de negocio) — ya no se buscan
// gimnasios, talleres, restaurantes, etc.
const CATEGORIAS = [
  // Clínicas y consultorios — general y por especialidad
  "clínicas médicas", "consultorios médicos generales", "consultorios de medicina familiar",
  "consultorios de medicina interna", "consultorios de pediatría", "consultorios de ginecología y obstetricia",
  "consultorios de cardiología", "consultorios de dermatología", "consultorios de oftalmología",
  "consultorios de otorrinolaringología", "consultorios de ortopedia y traumatología",
  "consultorios de psiquiatría", "consultorios de urología", "consultorios de gastroenterología",
  "consultorios de endocrinología", "consultorios de neurología", "consultorios de nefrología",
  "consultorios de reumatología", "consultorios de oncología", "consultorios de geriatría",
  "consultorios de alergología", "clínicas de especialidades médicas", "clínicas de fisioterapia y rehabilitación",
  "clínicas de psicología", "clínicas de nutrición", "laboratorios clínicos",
  // 2026-10-24: mas busquedas de laboratorios para alimentar su campana
  "laboratorios de análisis clínicos", "laboratorios de patología", "laboratorios dentales",
  "laboratorios de diagnóstico molecular", "bancos de sangre",
  "centros de diagnóstico por imagen",
  // Dental
  "consultorios dentales", "clínicas dentales", "ortodoncistas",
  // Hospitales pequeños/medianos
  "hospitales", "clínicas hospitalarias", "sanatorios",
  // Escuelas
  "escuelas primarias", "escuelas secundarias", "escuelas preparatorias", "colegios privados",
  "guarderías", "jardines de niños", "escuelas de educación especial",
  // Despachos contables — agregado el 2026-09-17, pedido explícito del
  // usuario: buscar también despachos contables en Google Maps,
  // ofreciendo el ángulo específico de "Inteligencia Artificial aplicada
  // a la Contabilidad" (ver _prospectingPrompt.js).
  "despachos contables",
];

const CIUDADES = [
  "Ciudad de México", "Guadalajara", "Monterrey", "Puebla", "Toluca", "Querétaro",
  "León", "Mérida", "Tijuana", "Juárez", "Torreón", "San Luis Potosí", "Aguascalientes",
  "Cancún", "Chihuahua", "Morelia", "Culiacán", "Hermosillo", "Saltillo", "Veracruz",
  "Villahermosa", "Xalapa", "Mexicali", "Tampico", "Durango", "Oaxaca", "Tuxtla Gutiérrez",
  "Pachuca", "Cuernavaca", "Colima", "Zacatecas", "Campeche", "La Paz", "Tepic", "Chetumal",
];

function elegirAlAzar(lista) {
  return lista[Math.floor(Math.random() * lista.length)];
}

// Elige una combinación rubro+ciudad que NUNCA se haya scrapeado antes —
// pedido explícito del usuario el 2026-09-08: "en apify... siempre buscar
// clientes nuevos... como lo haras, los vas guardando en mongo db?". Antes
// se elegía 100% al azar sin memoria, lo que con el tiempo repetía
// combinaciones ya cubiertas y gastaba crédito de Apify scrapeando un área
// que probablemente ya tenía cubierta (los negocios duplicados se
// descartaban después, pero el crédito del scrapeo en sí no se recuperaba).
// Con 96 rubros x 35 ciudades = 3,360 combinaciones y ~25/día, alcanza
// para más de 4 meses antes de necesitar reiniciar el conteo.
async function elegirComboNuevo(db) {
  const col = db.collection("combosScrapeados");
  const usados = await col.find({}).project({ categoria: 1, ciudad: 1, _id: 0 }).toArray();
  const usadosSet = new Set(usados.map((u) => `${u.categoria}|||${u.ciudad}`));

  const disponibles = [];
  for (const categoria of CATEGORIAS) {
    for (const ciudad of CIUDADES) {
      if (!usadosSet.has(`${categoria}|||${ciudad}`)) disponibles.push({ categoria, ciudad });
    }
  }

  let combo;
  let reinicio = false;
  if (!disponibles.length) {
    // Se agotaron las 3,360 combinaciones posibles — reinicia el conteo,
    // ya se cubrió todo el universo de rubros/ciudades al menos una vez.
    await col.deleteMany({});
    reinicio = true;
    combo = { categoria: elegirAlAzar(CATEGORIAS), ciudad: elegirAlAzar(CIUDADES) };
  } else {
    combo = disponibles[Math.floor(Math.random() * disponibles.length)];
  }

  await col.insertOne({ ...combo, createdAt: new Date() });
  return { ...combo, combosRestantes: disponibles.length - (reinicio ? 0 : 1), reinicio };
}

module.exports = { CATEGORIAS, CIUDADES, elegirAlAzar, elegirComboNuevo };

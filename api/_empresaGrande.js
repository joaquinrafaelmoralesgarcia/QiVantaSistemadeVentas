// Detección aproximada de "esto probablemente es una empresa mediana/
// grande, no un negocio local chico" para leads de Google Maps/Apify —
// pedido explícito del usuario el 2026-09-10: "en la campaña de google
// maps de apify tienes que hacer lo mismo para empresas de mas de 100
// empleados si hay forma de validarlo".
//
// A diferencia de Apollo (que trae organization.estimated_num_employees
// real), Google Business Profile NO tiene campo de número de empleados —
// confirmado revisando los campos que devuelve el actor de Apify
// (title, address, phone, website, totalScore, reviewsCount, categoryName,
// url, emails — ninguno es tamaño de plantilla). Por diseño, esta campaña
// busca por giro+ciudad ("gimnasios en Toluca"), así que la gran mayoría
// de resultados SÍ son negocios locales de una sola sucursal donde el
// catálogo PYME ya encaja — esto es solo para detectar la minoría de
// casos donde cae una sucursal de una cadena/corporativo grande.
//
// Es una ESTIMACIÓN, no un dato validado — el usuario lo aceptó
// explícitamente como tal ("Construir la estimación (Recomendado)").
const UMBRAL_RESENAS = 300;

const CATEGORIAS_GRANDES = [
  "banco", "hospital", "universidad", "centro comercial", "aeropuerto",
  "aseguradora", "supermercado", "hipermercado", "cadena de farmacias",
  "farmacia", "corporativo", "call center", "planta industrial", "fábrica",
  "almacén", "centro de distribución", "cadena hotelera", "hotel",
];

// Cadenas/franquicias grandes conocidas en México/LatAm por categoría —
// no exhaustiva, cubre las más comunes que podrían aparecer en búsquedas
// locales de Google Maps (bancos, retail, farmacias, comida rápida,
// gasolineras, hoteles). Comparación por substring en minúsculas.
const CADENAS_CONOCIDAS = [
  // Bancos / financieras
  "bbva", "santander", "banorte", "hsbc", "citibanamex", "banamex", "scotiabank", "inbursa", "banco azteca", "banco del bajio", "banbajio",
  // Retail / autoservicio
  "walmart", "bodega aurrera", "sam's club", "liverpool", "coppel", "soriana", "chedraui", "superama", "costco", "home depot", "office depot", "elektra",
  // Farmacias
  "farmacias del ahorro", "farmacias guadalajara", "farmacias similares", "farmacia san pablo", "farmacia benavides",
  // Tiendas de conveniencia / franquicias de cadena
  "oxxo", "7-eleven", "seven eleven", "circle k", "super k", "extra", "go express",
  // Comida rápida / cafeterías de cadena
  "mcdonald's", "mcdonalds", "burger king", "kfc", "starbucks", "domino's", "dominos", "little caesars", "subway", "pizza hut", "carl's jr",
  // Gasolineras
  "pemex", "shell", "bp gas", "g500", "oxxo gas",
  // Renta de autos — agregado el 2026-09-13 tras encontrarlas con
  // duplicados reales (Enterprise/Avis aparecían con sucursales
  // distintas compartiendo teléfono/correo corporativo)
  "enterprise rent-a-car", "avis", "hertz", "budget rent a car", "national car rental", "alamo rent a car",
  // Hoteles de cadena
  "city express", "fiesta inn", "holiday inn", "hampton inn", "marriott", "hilton", "nh hotel", "fiesta americana", "camino real",
  // Otros corporativos comunes en búsquedas locales
  "cemex", "femsa", "bimbo", "grupo modelo", "gnp seguros", "axa seguros", "metlife", "allianz",
];

// Solo el nombre — a diferencia de detectarEmpresaGrande() (que también
// usa reseñas/categoría como proxy de tamaño), esto es específicamente
// para EXCLUIR cadenas/franquicias reales de Google Maps — pedido
// explícito del usuario el 2026-09-12: "quita de la campaña google maps,
// cadenas de este tipo como oxxo, seven, super k, etc, franquicias debes
// omitirlas... para no mandarles ni correo ni llamadas". Una sucursal de
// OXXO no tiene autoridad de compra — la decisión está en corporativo,
// inalcanzable desde una ficha de Google Maps de una tienda local. No se
// usa reseñas/categoría aquí porque esas señales SÍ pueden ser un negocio
// independiente grande y legítimo (ese caso sigue recibiendo el catálogo
// "empresa grande", no se excluye).
function esCadenaConocida(nombre) {
  const nombreLower = (nombre || "").toLowerCase();
  return CADENAS_CONOCIDAS.find((c) => nombreLower.includes(c)) || null;
}

// Dominios de correo de plataformas/agregadores (no negocios en sí) que
// Google Business Profile a veces expone como "el correo del negocio" en
// vez del correo real del doctor/clínica — pedido explícito del usuario
// el 2026-09-13 tras encontrar, con la validación diaria de integridad,
// que "contacto-mx@doctoralia.com" (correo genérico de la plataforma de
// citas médicas Doctoralia) aparecía como correo de 11 clínicas/doctores
// totalmente distintos, generando 11 correos casi idénticos a la MISMA
// bandeja de entrada. A diferencia de esCadenaConocida() (que excluye el
// negocio por completo), esto solo invalida el CORREO — el teléfono de
// cada doctor/clínica sí es real y distinto, sigue siendo contactable por
// llamada o WhatsApp, igual que un dominio con MX inválido.
const DOMINIOS_CORREO_EXCLUIDOS = ["doctoralia.com"];

function esCorreoDePlataformaExcluida(correo) {
  const correoLower = (correo || "").toLowerCase();
  return DOMINIOS_CORREO_EXCLUIDOS.find((d) => correoLower.endsWith("@" + d)) || null;
}

function detectarEmpresaGrande(negocio) {
  const senales = [];
  const nombreLower = (negocio.nombre || "").toLowerCase();
  const categoriaLower = (negocio.categoria || "").toLowerCase();

  if (typeof negocio.numResenas === "number" && negocio.numResenas >= UMBRAL_RESENAS) {
    senales.push(`${negocio.numResenas} reseñas (>= ${UMBRAL_RESENAS})`);
  }

  const categoriaGrande = CATEGORIAS_GRANDES.find((c) => categoriaLower.includes(c));
  if (categoriaGrande) senales.push(`categoría "${negocio.categoria}" sugiere escala (coincide con "${categoriaGrande}")`);

  const cadena = CADENAS_CONOCIDAS.find((c) => nombreLower.includes(c));
  if (cadena) senales.push(`nombre coincide con cadena conocida ("${cadena}")`);

  return { probablementeGrande: senales.length > 0, senales };
}

module.exports = { detectarEmpresaGrande, esCadenaConocida, esCorreoDePlataformaExcluida, UMBRAL_RESENAS, CATEGORIAS_GRANDES, CADENAS_CONOCIDAS };

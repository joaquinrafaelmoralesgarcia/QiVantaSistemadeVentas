// Universo de rubros y ubicaciones para el scrapeo diario automático
// (api/cron-scrape-start.js). Cubre cualquier tipo de negocio en
// cualquier ciudad/estado de México, rotando combinaciones al azar
// cada día para dar cobertura amplia con el tiempo.
const CATEGORIAS = [
  // Salud
  "clínicas médicas", "consultorios dentales", "veterinarias", "laboratorios clínicos",
  "clínicas de fisioterapia", "centros de rehabilitación", "ópticas", "clínicas de nutrición",
  "psicólogos", "centros de diagnóstico",
  // Belleza
  "estéticas", "barberías", "spas", "clínicas de depilación", "clínicas estéticas",
  "salones de uñas", "academias de belleza",
  // Fitness
  "gimnasios", "boxes de crossfit", "estudios de yoga", "estudios de pilates",
  "academias de artes marciales", "escuelas de natación", "entrenadores personales",
  // Educación
  "escuelas privadas", "guarderías", "colegios", "academias de idiomas",
  "cursos de computación", "centros de capacitación", "academias de música", "escuelas de danza",
  // Restaurantes y alimentos
  "restaurantes", "cafeterías", "panaderías", "pastelerías", "taquerías", "pizzerías",
  "marisquerías", "food trucks", "heladerías",
  // Comercio
  "ferreterías", "papelerías", "tiendas de conveniencia", "tiendas de ropa", "zapaterías",
  "boutiques", "joyerías", "tiendas de mascotas", "tiendas de celulares", "tiendas de cómputo",
  "refaccionarias", "mueblerías", "colchonerías", "florerías",
  // Automotriz
  "talleres mecánicos", "llanteras", "hojalatería y pintura", "autolavados",
  "agencias de seminuevos", "verificentros", "talleres eléctricos automotrices", "talleres de motos",
  // Construcción
  "constructoras", "despachos de arquitectos", "despachos de ingeniería", "instaladores eléctricos",
  "plomeros", "pintores de casas", "empresas de impermeabilización", "vidrierías",
  "carpinterías", "herrerías",
  // Industria
  "talleres de maquinado", "metalmecánicas", "fabricantes de muebles", "fabricantes de plásticos",
  "empacadoras", "imprentas", "textileras", "fabricantes de alimentos",
  // Servicios profesionales
  "despachos contables", "despachos jurídicos", "consultoras de TI", "agencias de marketing",
  "agencias de publicidad", "empresas de recursos humanos", "empresas de reclutamiento",
  "call centers", "desarrolladores de software", "empresas de ciberseguridad",
  // Logística
  "paquetería local", "mensajería", "transporte de carga", "fleteras", "almacenes",
  "operadores logísticos",
  // Inmobiliario
  "inmobiliarias", "administradoras de condominios", "peritos valuadores",
  "constructoras de vivienda",
  // Turismo
  "hoteles", "hostales", "agencias de viajes", "operadores turísticos", "rentadoras de autos",
  // Agroindustria
  "empacadoras agrícolas", "productores agrícolas", "invernaderos", "granjas avícolas", "ganaderas",
  // Tecnología
  "integradores de sistemas", "empresas de ERP", "soporte de TI", "proveedores de internet",
  "desarrollo de aplicaciones", "automatización industrial",
  // Otros servicios
  "lavanderías", "tintorerías", "empresas de limpieza", "seguridad privada", "control de plagas",
  "empresas de CCTV", "instaladores de paneles solares", "empresas de aire acondicionado",
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

module.exports = { CATEGORIAS, CIUDADES, elegirAlAzar };

const { procesarPersonaEmpresa } = require("./_leadsProcessorComun");

// Importación manual de contactos para Piloto LATAM desde herramientas
// sin API gratis (Clay, Snov.io, Lusha, Kaspr) — pedido explícito del
// usuario el 2026-09-07: "podemos encontrar clientes con clay gratis 14
// dias... avancemos con eso". El usuario arma la lista a mano en la
// herramienta que elija y pega/sube el CSV en el panel — de ahí en
// adelante corre el mismo flujo que Apollo/Hunter (validar MX, generar el
// correo con generarScriptEmpresa, mandar a Smartlead, evitar duplicados).
//
// Cada herramienta exporta con nombres de columna distintos (email vs
// correo, company vs empresa, etc.) — normalizarFila() acepta las
// variantes más comunes en vez de exigir un formato exacto.
const ALIAS_CORREO = ["correo", "email", "e-mail", "work email", "business email", "correo electronico", "correo electrónico"];
const ALIAS_NOMBRE = ["nombre", "name", "full name", "fullname", "nombre completo"];
const ALIAS_NOMBRE_PILA = ["first name", "first_name", "nombre de pila"];
const ALIAS_APELLIDO = ["last name", "last_name", "apellido", "apellidos"];
const ALIAS_EMPRESA = ["empresa", "company", "company name", "organization", "organización", "organizacion"];
const ALIAS_TITULO = ["titulo", "título", "title", "position", "job title", "puesto", "cargo"];

function buscarValor(filaLower, alias) {
  for (const clave of alias) {
    if (filaLower[clave] != null && String(filaLower[clave]).trim()) return String(filaLower[clave]).trim();
  }
  return "";
}

function normalizarFila(filaCruda) {
  const filaLower = {};
  for (const [clave, valor] of Object.entries(filaCruda)) {
    filaLower[clave.trim().toLowerCase()] = valor;
  }

  const correo = buscarValor(filaLower, ALIAS_CORREO).toLowerCase();
  let nombre = buscarValor(filaLower, ALIAS_NOMBRE);
  if (!nombre) {
    const pila = buscarValor(filaLower, ALIAS_NOMBRE_PILA);
    const apellido = buscarValor(filaLower, ALIAS_APELLIDO);
    nombre = `${pila} ${apellido}`.trim();
  }
  const empresa = buscarValor(filaLower, ALIAS_EMPRESA);
  const titulo = buscarValor(filaLower, ALIAS_TITULO);

  return { correo, nombre, empresa, titulo };
}

async function importarFilas(leadsCol, filasCrudas, origen) {
  let sinCorreo = 0;
  let yaExistian = 0;
  let correosInvalidos = 0;
  let correosEnviados = 0;
  let erroresCorreo = 0;

  for (const filaCruda of filasCrudas) {
    const persona = normalizarFila(filaCruda);
    if (!persona.correo || !persona.correo.includes("@")) {
      sinCorreo++;
      continue;
    }

    const { resultado } = await procesarPersonaEmpresa(leadsCol, persona, origen);
    if (resultado === "ya_existia") yaExistian++;
    else if (resultado === "correo_invalido") correosInvalidos++;
    else if (resultado === "enviado") correosEnviados++;
    else if (resultado === "error_smartlead") erroresCorreo++;
  }

  return { totalFilas: filasCrudas.length, sinCorreo, yaExistian, correosInvalidos, correosEnviados, erroresCorreo };
}

module.exports = { importarFilas };

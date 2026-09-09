// Lista semilla de dominios de empresas medianas/grandes en LatAm para
// alimentar la búsqueda por dominio de Hunter.io (Piloto LATAM) —
// agregada el 2026-09-07. Hunter no descubre empresas por sí solo (a
// diferencia de Apollo), necesita que le des el dominio — esta lista es
// el punto de partida; se puede ampliar en cualquier momento agregando
// más dominios aquí o directo en la colección "dominiosLatam" de Mongo.
// "Todo tipo de empresa" (pedido explícito del usuario): variedad de
// países y sectores (banca, retail, aerolíneas, alimentos, minería,
// industria, tecnología), no solo un rubro.
const DOMINIOS_SEMILLA = [
  // México
  "cemex.com", "femsa.com", "grupobimbo.com", "gruposalinas.com", "televisa.com",
  "bbva.mx", "banorte.com", "liverpool.com.mx", "walmex.mx", "cinepolis.com",
  "aeromexico.com", "volaris.com", "softtek.com", "alsea.com.mx", "gentera.com.mx",
  "kof.com.mx", "gruposura.com.mx", "elektra.mx", "chedraui.com.mx", "vitro.com",

  // Brasil
  "itau.com.br", "bradesco.com.br", "vale.com", "petrobras.com.br", "ambev.com.br",
  "magazineluiza.com.br", "natura.com.br", "embraer.com", "jbs.com.br", "gerdau.com",
  "localiza.com", "azul.com.br", "gol.com.br", "b3.com.br", "nubank.com.br",
  "stone.com.br", "totvs.com", "cielo.com.br", "americanas.com.br", "cvc.com.br",

  // Colombia
  "grupoexito.com", "bancolombia.com", "ecopetrol.com.co", "avianca.com",
  "gruposura.com", "nutresa.com", "argos.co", "grupoaval.com", "davivienda.com",
  "terpel.com",

  // Argentina
  "mercadolibre.com", "ypf.com", "arcor.com", "techint.com", "globant.com",
  "despegar.com", "telecom.com.ar", "bancogalicia.com.ar", "molinos.com.ar",

  // Chile
  "falabella.com", "latam.com", "codelco.com", "cencosud.com", "bci.cl",
  "bancochile.cl", "entel.cl", "sqm.com", "cmpc.com", "ripley.cl",

  // Perú
  "bcp.com.pe", "interbank.pe", "credicorp.com", "alicorp.com.pe", "gloria.com.pe",
  "backus.pe",

  // Ecuador y Centroamérica
  "pronaca.com", "produbanco.com.ec", "bancopichincha.com", "fifco.com", "copa.com",
];

module.exports = { DOMINIOS_SEMILLA };

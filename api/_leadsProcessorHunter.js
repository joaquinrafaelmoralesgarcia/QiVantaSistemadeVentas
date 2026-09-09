const { buscarCorreosEnDominio } = require("./_hunter");
const { DOMINIOS_SEMILLA } = require("./_hunterDominios");
const { procesarPersonaEmpresa } = require("./_leadsProcessorComun");

const DOMINIOS_POR_CORRIDA = 15; // cada domain-search es 1 llamada rápida, esto se queda bien dentro de los 60s de Vercel

// Espejo de _leadsProcessorEmpresa.js (Apollo) pero para Hunter.io —
// agregado el 2026-09-07 mientras se renuevan los créditos de Apollo.
// Diferencia clave: Hunter no "descubre" personas, hay que darle una
// lista de dominios ya conocidos (ver _hunterDominios.js) — el dedup aquí
// es por DOMINIO consultado (no repetir la misma empresa dos veces); el
// dedup por correo ya existente lo hace _leadsProcessorComun.js.
async function procesarDominiosHunter(db) {
  const dominiosCol = db.collection("dominiosLatam");

  const yaHaySemillas = await dominiosCol.countDocuments({}, { limit: 1 });
  if (!yaHaySemillas) {
    await dominiosCol.insertMany(
      DOMINIOS_SEMILLA.map((dominio) => ({ dominio, procesado: false, createdAt: new Date() }))
    );
  }

  const pendientes = await dominiosCol.find({ procesado: false }).limit(DOMINIOS_POR_CORRIDA).toArray();
  if (!pendientes.length) {
    return { sinDominiosPendientes: true, dominiosConsultados: 0, correosEnviados: 0, detenidoPorCuota: false };
  }

  const leadsCol = db.collection("leads");
  let sinResultados = 0;
  let yaExistian = 0;
  let correosInvalidos = 0;
  let correosEnviados = 0;
  let erroresCorreo = 0;
  let dominiosConsultados = 0;
  let detenidoPorCuota = false;
  let cuentaRestringida = false;

  for (const { _id, dominio } of pendientes) {
    let personas;
    try {
      personas = await buscarCorreosEnDominio(dominio);
    } catch (err) {
      if (err.sinCreditos || err.cuentaRestringida) {
        detenidoPorCuota = true;
        cuentaRestringida = Boolean(err.cuentaRestringida);
        break; // no marca procesado — se reintenta este mismo dominio la próxima vez que corra
      }
      console.error("Error consultando Hunter para", dominio, err.message);
      await dominiosCol.updateOne({ _id }, { $set: { procesado: true, error: err.message } });
      dominiosConsultados++;
      continue;
    }

    dominiosConsultados++;
    await dominiosCol.updateOne({ _id }, { $set: { procesado: true, correosEncontrados: personas.length } });

    if (!personas.length) {
      sinResultados++;
      continue;
    }

    for (const persona of personas) {
      const { resultado } = await procesarPersonaEmpresa(leadsCol, persona, "hunter_latam", { dominio });
      if (resultado === "ya_existia") yaExistian++;
      else if (resultado === "correo_invalido") correosInvalidos++;
      else if (resultado === "enviado") correosEnviados++;
      else if (resultado === "error_smartlead") erroresCorreo++;
    }
  }

  return {
    sinDominiosPendientes: false,
    dominiosConsultados,
    sinResultados,
    yaExistian,
    correosInvalidos,
    correosEnviados,
    erroresCorreo,
    detenidoPorCuota,
    cuentaRestringida,
  };
}

module.exports = { procesarDominiosHunter };

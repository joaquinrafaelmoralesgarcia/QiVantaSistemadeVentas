// Protección mínima para las rutas /api/leads* y /api/admin.
// El panel manda la contraseña en el header X-Admin-Password (la guarda en
// localStorage tras pedirla una vez). No es un sistema de usuarios real —
// solo evita que cualquiera que encuentre la URL vea datos de leads.
function requiereAdmin(req, res) {
  const configurada = process.env.ADMIN_PASSWORD;
  if (!configurada) {
    res.status(500).json({ error: "Falta configurar ADMIN_PASSWORD en el servidor." });
    return false;
  }
  const recibida = req.headers["x-admin-password"];
  if (recibida !== configurada) {
    res.status(401).json({ error: "No autorizado." });
    return false;
  }
  return true;
}

module.exports = { requiereAdmin };

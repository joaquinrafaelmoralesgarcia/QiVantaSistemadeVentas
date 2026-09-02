// El widget de chat se va a embeber en qi-vanta.com (Cloudflare), mientras el
// backend vive en Vercel — son orígenes distintos, así que el navegador
// necesita estas cabeceras para permitir la llamada desde el sitio.
// Devuelve true si ya respondió (preflight OPTIONS) y el handler debe cortar ahí.
function aplicarCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}

module.exports = { aplicarCors };

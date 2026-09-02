async function enviarRespuestaWati(waId, texto) {
  const baseUrl = process.env.WATI_API_ENDPOINT;
  const token = process.env.WATI_API_TOKEN;

  if (!baseUrl || !token) {
    throw new Error("Falta configurar WATI_API_ENDPOINT y/o WATI_API_TOKEN.");
  }

  const url = `${baseUrl.replace(/\/$/, "")}/api/v1/sendSessionMessage/${encodeURIComponent(waId)}?messageText=${encodeURIComponent(texto)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`WATI respondió con error (${res.status}): ${errBody}`);
  }
}

module.exports = { enviarRespuestaWati };

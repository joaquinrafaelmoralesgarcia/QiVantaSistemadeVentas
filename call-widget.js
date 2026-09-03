// Botón "Llámame" embebible para qi-vanta.com — dispara una llamada real
// vía Vapi (voz IA) al número del Twilio ya contratado. Distinto de
// widget.js (chat flotante): este se coloca donde tú quieras en la página,
// no flota fijo, para no competir visualmente con el botón de chat.
//
// Uso:
//   <div id="qv-call-widget"></div>
//   <script src="https://<tu-deploy>.vercel.app/call-widget.js" data-api-base="https://<tu-deploy>.vercel.app" defer></script>
(function () {
  const API_BASE = document.currentScript?.dataset?.apiBase || "";
  const contenedor = document.getElementById("qv-call-widget");
  if (!contenedor) return;

  const STYLE = `
    .qvc-box { font-family: Archivo, system-ui, sans-serif; display: inline-block; }
    .qvc-btn {
      display: inline-flex; align-items: center; gap: 10px;
      height: 52px; padding: 0 22px; border: 0; border-radius: 999px;
      background: linear-gradient(135deg, #22d3ee, #2563eb); color: #04121f;
      font: 700 15px/1 Archivo, system-ui, sans-serif; cursor: pointer;
      box-shadow: 0 12px 30px rgba(34, 211, 238, 0.35);
    }
    .qvc-btn:disabled { opacity: .6; cursor: not-allowed; }
    .qvc-panel {
      margin-top: 12px; padding: 16px; border-radius: 14px; max-width: 360px;
      background: #0a1120; border: 1px solid rgba(255,255,255,0.08);
      color: #eef2f9;
    }
    .qvc-panel p { margin: 0 0 10px; font-size: 13px; color: #c7d0e6; }
    .qvc-row { display: flex; gap: 8px; }
    .qvc-input {
      flex: 1; min-width: 0; border: 1px solid rgba(255,255,255,0.14); border-radius: 10px;
      background: #0c1424; color: #eef2f9; padding: 10px 12px; font: 13.5px Archivo, system-ui, sans-serif;
      outline: none;
    }
    .qvc-input::placeholder { color: #5a6787; }
    .qvc-send {
      border: 0; border-radius: 10px; padding: 0 18px; cursor: pointer;
      background: linear-gradient(135deg, #22d3ee, #2563eb); color: #04121f; font-weight: 700;
    }
    .qvc-send:disabled { opacity: .6; cursor: not-allowed; }
    .qvc-status { margin-top: 10px; font-size: 12.5px; color: #8f9bb8; min-height: 16px; }
    .qvc-status.err { color: #f87171; }
    .qvc-status.ok { color: #4ade80; }
    .qvc-hidden { display: none !important; }
  `;
  const styleEl = document.createElement("style");
  styleEl.textContent = STYLE;
  document.head.appendChild(styleEl);

  const box = document.createElement("div");
  box.className = "qvc-box";
  box.innerHTML = `
    <button class="qvc-btn" type="button">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
      <span>¡Llámame!</span>
    </button>
    <div class="qvc-panel qvc-hidden">
      <p>Déjanos tu número y te llamamos en segundos con nuestro asistente de IA.</p>
      <form class="qvc-form">
        <div class="qvc-row">
          <input class="qvc-input" type="tel" placeholder="Tu teléfono, ej. 55 1234 5678" required />
          <button class="qvc-send" type="submit">Llamar</button>
        </div>
      </form>
      <div class="qvc-status"></div>
    </div>
  `;
  contenedor.appendChild(box);

  const btnAbrir = box.querySelector(".qvc-btn");
  const panel = box.querySelector(".qvc-panel");
  const form = box.querySelector(".qvc-form");
  const input = box.querySelector(".qvc-input");
  const sendBtn = box.querySelector(".qvc-send");
  const statusEl = box.querySelector(".qvc-status");

  btnAbrir.addEventListener("click", () => {
    panel.classList.remove("qvc-hidden");
    btnAbrir.classList.add("qvc-hidden");
    input.focus();
  });

  function setStatus(texto, tipo) {
    statusEl.textContent = texto || "";
    statusEl.className = `qvc-status${tipo ? " " + tipo : ""}`;
  }

  async function seguirLlamada(callId, intentos) {
    if (intentos <= 0) return;
    try {
      const res = await fetch(`${API_BASE}/api/vapi?callId=${encodeURIComponent(callId)}`);
      const data = await res.json();
      if (data.status === "ended") {
        setStatus("Llamada finalizada. ¡Gracias por tu tiempo!", "ok");
        return;
      }
      if (data.status === "in-progress") setStatus("En llamada ahora mismo...", "ok");
      else if (data.status === "ringing") setStatus("Tu teléfono está sonando...", "ok");
      setTimeout(() => seguirLlamada(callId, intentos - 1), 5000);
    } catch {
      // silencioso — no crítico si falla el seguimiento, la llamada ya se disparó
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const numero = input.value.trim();
    if (!numero) return;

    input.disabled = true;
    sendBtn.disabled = true;
    setStatus("Marcando...");

    try {
      const res = await fetch(`${API_BASE}/api/vapi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: numero }),
      });
      const data = await res.json();

      if (!res.ok) {
        setStatus(data.error || "No se pudo iniciar la llamada.", "err");
        input.disabled = false;
        sendBtn.disabled = false;
        return;
      }

      setStatus("¡Te estamos llamando! Contesta tu teléfono.", "ok");
      if (data.callId) seguirLlamada(data.callId, 24); // ~2 min de seguimiento
    } catch {
      setStatus("Error de conexión. Intenta de nuevo en un momento.", "err");
      input.disabled = false;
      sendBtn.disabled = false;
    }
  });
})();

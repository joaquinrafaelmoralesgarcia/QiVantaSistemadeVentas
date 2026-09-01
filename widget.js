// Widget de chat embebible para qi-vanta.com.
// Uso: <script src="https://<tu-deploy>.vercel.app/widget.js" defer></script>
// El script se inyecta a sí mismo (CSS + DOM), no requiere nada más en la página host.
(function () {
  const API_BASE = document.currentScript?.dataset?.apiBase || "";

  const STYLE = `
    .qv-fab {
      position: fixed; right: 24px; bottom: 24px; z-index: 2147483000;
      display: inline-flex; align-items: center; gap: 10px;
      height: 52px; padding: 0 20px; border: 0; border-radius: 999px;
      background: linear-gradient(135deg, #22d3ee, #2563eb); color: #04121f;
      font: 700 14px/1 Archivo, system-ui, sans-serif; cursor: pointer;
      box-shadow: 0 12px 30px rgba(34, 211, 238, 0.35);
    }
    .qv-fab svg { width: 20px; height: 20px; }
    .qv-shell {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
      width: min(400px, calc(100vw - 32px)); max-height: min(620px, calc(100vh - 100px));
      display: grid; grid-template-rows: auto minmax(0, 1fr) auto;
      background: #0a1120; border: 1px solid rgba(255,255,255,0.08);
      border-radius: 16px; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,0.5);
      font-family: Archivo, system-ui, sans-serif;
    }
    .qv-header {
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      padding: 14px 16px; background: #070b16; color: #eef2f9;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .qv-header-info { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .qv-avatar {
      width: 36px; height: 36px; border-radius: 10px; flex: 0 0 auto;
      background: linear-gradient(135deg, #22d3ee, #2563eb);
      display: grid; place-items: center; color: #04121f;
    }
    .qv-header strong { display: block; font-size: 14px; line-height: 1.2; }
    .qv-header small { color: #8f9bb8; font-size: 11px; }
    .qv-close {
      border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.06);
      color: #eef2f9; width: 30px; height: 30px; border-radius: 8px; cursor: pointer;
    }
    .qv-body { overflow-y: auto; padding: 16px; display: grid; gap: 10px; align-content: start; background: #0a1120; }
    .qv-msg { display: flex; gap: 8px; max-width: 88%; }
    .qv-msg.user { flex-direction: row-reverse; margin-left: auto; }
    .qv-bubble {
      padding: 10px 12px; border-radius: 12px; font-size: 13.5px; line-height: 1.45;
      background: #101a30; color: #eef2f9; border: 1px solid rgba(255,255,255,0.06);
      white-space: pre-wrap;
    }
    .qv-msg.user .qv-bubble { background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #fff; border-color: transparent; }
    .qv-typing { display: flex; gap: 4px; padding: 12px; }
    .qv-typing span {
      width: 6px; height: 6px; border-radius: 50%; background: #38bdf8;
      animation: qvPulse 1.1s infinite ease-in-out;
    }
    .qv-typing span:nth-child(2) { animation-delay: .15s; }
    .qv-typing span:nth-child(3) { animation-delay: .3s; }
    @keyframes qvPulse { 0%,100% { opacity: .3; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-3px); } }
    .qv-footer {
      display: flex; gap: 8px; padding: 12px; background: #070b16;
      border-top: 1px solid rgba(255,255,255,0.06);
    }
    .qv-input {
      flex: 1; min-width: 0; border: 1px solid rgba(255,255,255,0.14); border-radius: 10px;
      background: #0c1424; color: #eef2f9; padding: 10px 12px; font: 13.5px Archivo, system-ui, sans-serif;
      outline: none;
    }
    .qv-input::placeholder { color: #5a6787; }
    .qv-send {
      border: 0; border-radius: 10px; padding: 0 16px; cursor: pointer;
      background: linear-gradient(135deg, #22d3ee, #2563eb); color: #04121f; font-weight: 700;
    }
    .qv-send:disabled, .qv-input:disabled { opacity: .6; cursor: not-allowed; }
    .qv-hidden { display: none !important; }
  `;

  const styleEl = document.createElement("style");
  styleEl.textContent = STYLE;
  document.head.appendChild(styleEl);

  const fab = document.createElement("button");
  fab.className = "qv-fab";
  fab.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg><span>Hablar con Qi-Vanta</span>`;

  const shell = document.createElement("aside");
  shell.className = "qv-shell qv-hidden";
  shell.innerHTML = `
    <header class="qv-header">
      <div class="qv-header-info">
        <span class="qv-avatar">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
        </span>
        <div>
          <strong>Asistente Qi-Vanta</strong>
          <small>Responde al instante</small>
        </div>
      </div>
      <button class="qv-close" type="button" aria-label="Cerrar">&times;</button>
    </header>
    <div class="qv-body"></div>
    <form class="qv-footer">
      <input class="qv-input" type="text" placeholder="Escribe tu pregunta..." autocomplete="off" />
      <button class="qv-send" type="submit">Enviar</button>
    </form>
  `;

  document.body.appendChild(fab);
  document.body.appendChild(shell);

  const body = shell.querySelector(".qv-body");
  const form = shell.querySelector("form");
  const input = shell.querySelector(".qv-input");
  const sendBtn = shell.querySelector(".qv-send");
  const closeBtn = shell.querySelector(".qv-close");

  const conversation = [];
  let opened = false;

  function addBubble(role, text) {
    const row = document.createElement("div");
    row.className = `qv-msg ${role === "user" ? "user" : "bot"}`;
    const bubble = document.createElement("div");
    bubble.className = "qv-bubble";
    bubble.textContent = text;
    row.appendChild(bubble);
    body.appendChild(row);
    body.scrollTop = body.scrollHeight;
  }

  function addTyping() {
    const row = document.createElement("div");
    row.className = "qv-msg bot";
    row.id = "qv-typing-row";
    row.innerHTML = `<div class="qv-bubble qv-typing"><span></span><span></span><span></span></div>`;
    body.appendChild(row);
    body.scrollTop = body.scrollHeight;
  }

  function removeTyping() {
    document.getElementById("qv-typing-row")?.remove();
  }

  function openShell() {
    shell.classList.remove("qv-hidden");
    fab.classList.add("qv-hidden");
    if (!opened) {
      opened = true;
      addBubble("bot", "Hola, soy el asistente de Qi-Vanta. Cuéntame qué reto de automatización o IA quieres resolver y te oriento.");
    }
    input.focus();
  }

  fab.addEventListener("click", openShell);
  closeBtn.addEventListener("click", () => {
    shell.classList.add("qv-hidden");
    fab.classList.remove("qv-hidden");
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    input.value = "";
    input.disabled = true;
    sendBtn.disabled = true;

    addBubble("user", text);
    conversation.push({ role: "user", content: text });
    addTyping();

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: conversation }),
      });
      const data = await res.json();
      removeTyping();

      if (!res.ok) {
        addBubble("bot", data.error || "No se pudo contactar al asistente en este momento.");
      } else {
        addBubble("bot", data.reply);
        conversation.push({ role: "assistant", content: data.reply });
      }
    } catch (err) {
      removeTyping();
      addBubble("bot", "Error de conexión. Intenta de nuevo en un momento.");
    }

    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  });
})();

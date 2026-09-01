# Qi-Vanta Chatbot

Backend + widget de chat con IA (Claude) para qi-vanta.com, con canal web y
WhatsApp (vía WATI). La lógica de voz IA la maneja Vapi directamente (el
asistente y su conversación se configuran en el dashboard de Vapi); este
backend solo dispara la llamada saliente y consulta su estado.

## Estructura

- `index.html` + `widget.js` — widget de chat embebible (FAB + panel). Para
  usarlo en qi-vanta.com, agrega en esa página:
  `<script src="https://<tu-deploy>.vercel.app/widget.js" defer></script>`
- `api/chat.js` — chat de texto con Claude para el widget web.
- `api/wati-webhook.js` — recibe mensajes de WhatsApp entrantes (webhook de
  WATI), responde con Claude y envía la respuesta de vuelta vía la API de WATI.
- `api/vapi-call.js` / `api/vapi-status.js` — disparan y consultan llamadas
  salientes de voz IA vía Vapi (usando tu propia cuenta de Vapi + Twilio).
- `api/_systemPrompt.js` — contexto de negocio de Qi-Vanta que usa el modelo
  para responder (servicios, industrias, contacto). Editar aquí si cambia
  algo del sitio.
- `api/_mongo.js` — conexión a MongoDB, usada por el webhook de WATI para
  recordar el historial de conversación por número de WhatsApp.

## Variables de entorno necesarias (Vercel → Settings → Environment Variables)

| Variable | Para qué |
|---|---|
| `ANTHROPIC_API_KEY` | Claude (chat web + WhatsApp) |
| `MONGODB_URI` | Memoria de conversación de WhatsApp |
| `WATI_API_ENDPOINT` | URL base de tu cuenta WATI (panel → API Docs) |
| `WATI_API_TOKEN` | Token de acceso de WATI |
| `VAPI_API_KEY` | Private Key de tu cuenta Vapi |
| `VAPI_PHONE_NUMBER_ID` | UUID del número de Twilio importado a Vapi |
| `VAPI_ASSISTANT_ID` | ID del asistente de voz configurado en Vapi |

## Pendiente de verificar con la cuenta real de WATI

`api/wati-webhook.js` está escrito de forma defensiva porque el formato
exacto del payload que WATI manda al webhook varía según la cuenta/versión.
Cuando tengas el webhook conectado, revisa los logs de Vercel (`console.log`
imprime el body crudo) para confirmar los nombres de campo reales y ajustar
`extraerMensajeEntrante()` si hace falta.

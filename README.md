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
  Deduplica por `whatsappMessageId` (WATI reintenta la entrega si no responde
  rápido, y sin esto se mandaban respuestas duplicadas al cliente real).
- `api/cron-seguimiento.js` — cron (cada 10 min, ver `vercel.json`) que manda
  hasta 2 mensajes de seguimiento por WhatsApp si el cliente no responde
  después de que el bot contestó (30 min y 1h). Solo aplica a clientes que
  escribieron primero — nunca contactos fríos, sigue dentro de la ventana de
  24h de WhatsApp. El "reloj" se reinicia cada vez que el bot vuelve a
  contestar algo del cliente.
- `api/_watiSend.js` — helper compartido para mandar mensajes de sesión por
  WATI (usado por el webhook y por el cron de seguimiento).
- `api/vapi-call.js` / `api/vapi-status.js` — disparan y consultan llamadas
  salientes de voz IA vía Vapi (usando tu propia cuenta de Vapi + Twilio).
- `api/_systemPrompt.js` — contexto de negocio de Qi-Vanta que usa el modelo
  para responder (servicios, industrias, contacto). Editar aquí si cambia
  algo del sitio.
- `api/_mongo.js` — conexión a MongoDB, usada por el webhook de WATI (memoria
  de conversación) y por el módulo de prospección (leads).

### Panel de prospección (`/admin.html`)

Herramienta interna de ventas, NO expuesta a clientes: busca negocios en
Google Maps vía Apify, los califica con Claude y genera un mensaje sugerido
por negocio. Para los que sí tienen correo público, se agregan automáticamente
a una campaña de Smartlead (correo frío). Para los que no, el panel da un
botón "Abrir WhatsApp" con el mensaje precargado — **el envío por WhatsApp
siempre lo dispara una persona con un clic, nunca es automático.** Esto es
intencional: WhatsApp Business prohíbe enviar mensajes automatizados a
números sin opt-in (riesgo real de que Meta suspenda la cuenta, la misma que
usa el bot de atención a clientes) y contactar así también puede violar la
LFPDPPP. Si en algún momento se te ocurre "solo automatizar el envío de
WhatsApp también", no lo hagas sin resolver primero el tema de consentimiento.

- `api/_apify.js` — dispara el scraping de Google Maps.
- `api/_leadScript.js` — Claude genera calificación + mensaje de WhatsApp +
  icebreaker de correo por negocio.
- `api/_smartlead.js` — agrega el lead a tu campaña de Smartlead cuando hay
  correo.
- `api/leads-scrape.js` — orquesta todo lo anterior y guarda en Mongo
  (colección `leads`), evitando duplicados por teléfono/URL de Google Maps.
- `api/leads.js` — lista/filtra leads y permite marcar estado
  (nuevo/contactado/descartado).
- `api/_adminAuth.js` — protección simple por contraseña compartida
  (header `X-Admin-Password`) para todas las rutas de leads.

## Variables de entorno necesarias (Vercel → Settings → Environment Variables)

| Variable | Para qué |
|---|---|
| `ANTHROPIC_API_KEY` | Claude (chat web + WhatsApp + calificación de leads) |
| `MONGODB_URI` | Memoria de conversación de WhatsApp + almacenamiento de leads |
| `WATI_API_ENDPOINT` | URL base de tu cuenta WATI (panel → API Docs) |
| `WATI_API_TOKEN` | Token de acceso de WATI |
| `VAPI_API_KEY` | Private Key de tu cuenta Vapi |
| `VAPI_PHONE_NUMBER_ID` | UUID del número de Twilio importado a Vapi |
| `VAPI_ASSISTANT_ID` | ID del asistente de voz configurado en Vapi |
| `APIFY_API_TOKEN` | Token de tu cuenta Apify |
| `APIFY_ACTOR_ID` | Opcional — actor de Google Maps a usar (default `compass~crawler-google-places`) |
| `SMARTLEAD_API_KEY` | API key de tu cuenta Smartlead |
| `SMARTLEAD_CAMPAIGN_ID` | Campaña de Smartlead donde caen los leads con correo |
| `ADMIN_PASSWORD` | Contraseña para entrar a `/admin.html` |
| `CRON_SECRET` | Protege `/api/cron-seguimiento` para que solo Vercel Cron pueda dispararlo |

## Pendiente de verificar antes del primer uso real

- **WATI** (`api/wati-webhook.js`): el formato exacto del payload del webhook
  varía por cuenta. Revisa los logs de Vercel (`console.log` imprime el body
  crudo) tras el primer mensaje de prueba y ajusta `extraerMensajeEntrante()`
  si hace falta.
- **Apify** (`api/_apify.js`): confirma en Apify Console el ID exacto del
  actor de Google Maps que vas a usar y los nombres de campo de su output
  (pueden diferir de los asumidos en `normalizarResultado()`).
- **Smartlead** (`api/_smartlead.js`): confirma el `campaign_id` y el formato
  del payload contra la documentación de tu cuenta antes del primer envío
  real.

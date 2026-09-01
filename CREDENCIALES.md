# Cómo sacar cada API key — paso a paso

Apify ya está listo (`APIFY_API_TOKEN` guardado en `.env.local`). Faltan estas.

## 1. Anthropic (Claude) — `ANTHROPIC_API_KEY`

1. Entra a **console.anthropic.com** e inicia sesión (o crea cuenta).
2. Si es cuenta nueva: **Settings → Billing** → agrega un método de pago y carga
   crédito prepagado (mínimo $5 USD) — sin esto las llamadas a la API fallan
   aunque la key sea válida.
3. **Settings → API Keys → Create Key**.
4. Ponle un nombre (ej. "qivanta-chatbot") y cópiala — empieza con `sk-ant-...`.
   Solo se muestra una vez.

## 2. MongoDB Atlas — `MONGODB_URI`

1. Entra a **mongodb.com/cloud/atlas/register** y crea cuenta (gratis).
2. Crea un **cluster gratuito** (M0 — Shared, 512MB, $0/mes es suficiente para
   esto).
3. **Database Access** (menú izquierdo) → **Add New Database User** → usuario
   y contraseña (autogenerada está bien, cópiala).
4. **Network Access** → **Add IP Address** → **Allow Access from Anywhere**
   (`0.0.0.0/0`) — Vercel no tiene IPs fijas, así que es necesario.
5. **Database → Connect** (botón en tu cluster) → **Drivers** → copia el
   connection string, se ve así:
   `mongodb+srv://usuario:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`
6. Reemplaza `<password>` por la contraseña real del paso 3. Ese string completo
   es el `MONGODB_URI`.

## 3. WATI (WhatsApp) — `WATI_API_ENDPOINT` + `WATI_API_TOKEN`

1. Entra a tu cuenta en **wati.io** (si no tienes, hay que darla de alta y
   conectar un número de WhatsApp Business — proceso de WATI, toma
   verificación con Meta).
2. En el panel, ve a **API Docs** (suele estar en el menú lateral o en
   Settings).
3. Ahí arriba aparece tu **URL base** propia (algo como
   `https://live-mt-server.wati.io/123456` o
   `https://live-server-XXXX.wati.io/123456`) — ese es el `WATI_API_ENDPOINT`
   completo (con el número de tenant incluido).
4. El **Access Token** (Bearer token) también está en esa misma pantalla —
   cópialo, es el `WATI_API_TOKEN`.
5. Además, configura el webhook: **Settings → Integrations/Webhooks** →
   agrega la URL `https://<tu-deploy-de-vercel>.vercel.app/api/wati-webhook`
   para el evento de "mensaje entrante" (el nombre exacto del evento varía,
   busca algo como "New Message Received"). Esto lo hacemos cuando ya
   tengamos el proyecto desplegado, porque necesitamos la URL final primero.

## 4. Vapi + Twilio (voz) — `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`, `VAPI_ASSISTANT_ID`

(Esto ya lo documentamos a fondo en `GUIA-INTEGRACION-VAPI-TWILIO.txt` del
proyecto de ANEPSA — mismos pasos, solo que ahora con tu cuenta de Vapi/Twilio
en vez de la de ANEPSA.)

1. **Vapi** (vapi.ai) → **Settings → API Keys** → copia la "Private Key" →
   ese es `VAPI_API_KEY`.
2. **Twilio** (twilio.com) → compra un número si no tienes uno para esto
   (Phone Numbers → Manage → Buy a number).
3. En Vapi: **Phone Numbers → Import** → elige Twilio → pide Account SID y
   Auth Token de Twilio (Twilio Console → Account Dashboard) y el número
   comprado. Al importarlo, Vapi genera un **Phone Number ID** (UUID) — ese
   es `VAPI_PHONE_NUMBER_ID` (no es el número ni el SID de Twilio).
4. Crea un asistente en Vapi (**Assistants → Create Assistant**) con el
   contexto de Qi-Vanta (puedo ayudarte a redactar el prompt del asistente
   de voz, avísame). Copia su ID — ese es `VAPI_ASSISTANT_ID`.
5. Conecta tu Anthropic Provider Key dentro de Vapi: **Settings → Provider
   Keys → Anthropic** → pega la misma `sk-ant-...` del paso 1. Sin esto las
   llamadas conectan pero la IA no responde.

## 5. Smartlead — `SMARTLEAD_API_KEY` + `SMARTLEAD_CAMPAIGN_ID`

1. Entra a tu cuenta en **app.smartlead.ai** (ya tienes las 6 cuentas de
   workspace conectadas, según me dijiste).
2. **Settings → API Key** (ícono de engranaje, usualmente abajo a la
   izquierda) → copia tu API key.
3. Crea o abre la campaña donde deben caer estos leads (**Campaigns →
   [tu campaña]**) — en la URL del navegador aparece el ID numérico de la
   campaña (ej. `app.smartlead.ai/app/campaign/123456/...`) → ese número es
   el `SMARTLEAD_CAMPAIGN_ID`.
4. Asegúrate de que esa campaña ya tenga su secuencia de correos escrita
   (asunto + cuerpo) — nuestro código solo agrega el lead con un campo extra
   `icebreaker` personalizado por IA; el resto del correo lo define la
   secuencia que armes en Smartlead.

## 6. Contraseña del panel — `ADMIN_PASSWORD`

No hay que "sacarla" de ningún lado — inventa una contraseña tú mismo (algo
larga y única, no la reutilices de otra cuenta) y pásamela para configurarla.

---

Conforme me vayas pasando cada una las voy guardando (igual que con Apify) y
cuando estén todas, desplegamos el proyecto completo en Vercel.

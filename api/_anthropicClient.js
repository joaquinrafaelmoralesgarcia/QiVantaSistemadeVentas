// Cliente compartido de Anthropic. La API key de esta cuenta es de tipo
// "identity-linked" y exige el header anthropic-workspace-id en cada request
// (verificado con una llamada real el 2026-09-01) — si en el futuro se usa
// una key de otro tipo que no lo requiera, ANTHROPIC_WORKSPACE_ID puede
// quedar sin definir y el header simplemente no se manda.
const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID
    ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID }
    : undefined,
});

module.exports = { client };

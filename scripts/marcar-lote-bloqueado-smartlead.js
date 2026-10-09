const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}
(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const result = await client.db(process.env.MONGODB_DB || "qivanta_chatbot").collection("leads").updateMany(
      { pruebaNocturna100: true },
      { $set: {
        emailEstado: "bloqueado_limite_contactos_smartlead",
        emailError: "Smartlead rechazó la importación: límite de almacenamiento/contactos alcanzado.",
        bloqueadoSmartleadAt: new Date(),
      }, $unset: { pruebaNocturna100: "", pruebaNocturna100At: "" } },
    );
    console.log(JSON.stringify({ matched: result.matchedCount, updated: result.modifiedCount }));
  } finally { await client.close(); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });

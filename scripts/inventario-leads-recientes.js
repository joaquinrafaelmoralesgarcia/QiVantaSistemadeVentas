// Inventario de solo lectura: leads captados ayer y hoy, por fuente/campaña.
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}

const until = new Date();
const since = new Date(until);
since.setDate(since.getDate() - 1);
since.setHours(0, 0, 0, 0);

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const leads = client.db(process.env.MONGODB_DB || "qivanta_chatbot").collection("leads");
    const match = {
      createdAt: { $gte: since, $lte: until },
      $or: [{ origen: "apollo_latam" }, { origenBusqueda: { $exists: true, $ne: "" } }],
    };
    const rows = await leads.aggregate([
      { $match: match },
      { $group: {
        _id: {
          source: { $cond: [{ $eq: ["$origen", "apollo_latam"] }, "apollo", "apify"] },
          campaignId: "$campaignId", campaignKey: "$campaignKey", campaignName: "$campaignName",
          emailReady: { $and: [{ $ne: ["$correo", null] }, { $ne: ["$correo", ""] }, { $eq: ["$emailEstado", "enviado_a_campana"] }] },
          estado: "$estado",
        },
        count: { $sum: 1 },
      } },
      { $sort: { "_id.source": 1, "_id.campaignName": 1, "_id.emailReady": -1 } },
    ]).toArray();
    console.log(JSON.stringify({ since: since.toISOString(), until: until.toISOString(), rows }, null, 2));
  } finally { await client.close(); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });

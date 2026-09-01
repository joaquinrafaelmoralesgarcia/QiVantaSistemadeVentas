const { MongoClient } = require("mongodb");

let cachedClient = null;
let cachedDb = null;

async function getDb() {
  if (cachedDb) return cachedDb;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("Falta configurar MONGODB_URI en las variables de entorno del servidor.");
  }

  if (!cachedClient) {
    cachedClient = new MongoClient(uri);
    await cachedClient.connect();
  }

  cachedDb = cachedClient.db(process.env.MONGODB_DB || "qivanta_chatbot");
  return cachedDb;
}

module.exports = { getDb };

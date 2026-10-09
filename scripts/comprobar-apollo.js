const fs = require("fs");
const path = require("path");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}

if (process.argv.includes("--from-file")) {
  process.env.APOLLO_API_KEY = fs.readFileSync("G:\\Apis\\apiapollo.txt", "utf8").trim();
}

require("../api/_apollo").obtenerCreditosLead()
  .then((credits) => console.log(JSON.stringify(credits)))
  .catch((error) => { console.error(error.message); process.exitCode = 1; });

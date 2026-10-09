const fs = require("fs");
const path = require("path");
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}

(async () => {
  const response = await fetch("https://chatbotwati.vercel.app/api/leads?tipo=status-campanas", {
    headers: { "X-Admin-Password": process.env.ADMIN_PASSWORD },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Vercel ${response.status}: ${JSON.stringify(data)}`);
  console.log(JSON.stringify(data.apolloCreditos || null));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });

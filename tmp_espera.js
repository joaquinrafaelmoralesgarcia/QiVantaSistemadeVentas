const { execSync } = require("child_process");
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  for (let i = 1; i <= 8; i++) {
    await espera(180000); // 3 min
    console.log(`\n--- revision ${i} (${new Date().toISOString().slice(11,19)} UTC) ---`);
    try { console.log(execSync("node scripts/canario-entrega.js --revisar", { cwd: "G:/chatbotwati", encoding: "utf8" })); }
    catch (e) { console.log(e.stdout || e.message); }
  }
})();

// Collecte réelle. Exécuté par GitHub Actions (jamais dans le Worker :
// règle qui prime sur tout, cf. amorçage section 3).
const { chromium } = require("playwright");
const fs = require("fs");

const WORKER_URL = process.env.WORKER_URL;

async function main() {
  const res = await fetch(`${WORKER_URL}/api/sources`);
  const sources = await res.json();
  const actives = sources.filter((s) => s.enabled);

  const browser = await chromium.launch();
  const rapport = [];

  for (const src of actives) {
    let config = {};
    try {
      config = JSON.parse(src.config_json || "{}");
    } catch (e) {}
    const urls = config.urls || [];
    let totalExtrait = 0;
    let erreur = null;
    const debutPassage = new Date().toISOString();

    for (const url of urls) {
      try {
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        if (config.js_render) await page.waitForTimeout(6000);
        const html = await page.content();
        await page.close();

        const ingestRes = await fetch(`${WORKER_URL}/api/ingest-raw`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source_name: src.name, url, html }),
        });
        const ingestJson = await ingestRes.json();
        totalExtrait += ingestJson.annonces_extraites || 0;
      } catch (e) {
        erreur = String(e && e.message ? e.message : e);
      }
    }

    // Une seule absence suffit à retirer une annonce en location (section 6
    // de l'amorçage) — on ne finalise que si la collecte de cette source
    // n'a pas planté, pour ne jamais retirer des annonces valides à cause
    // d'une simple erreur réseau.
    let retirees = 0;
    if (!erreur) {
      try {
        const finRes = await fetch(`${WORKER_URL}/api/finaliser-collecte`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source_name: src.name, depuis: debutPassage }),
        });
        const finJson = await finRes.json();
        retirees = finJson.annonces_retirees || 0;
      } catch (e) {
        // pas bloquant : au pire on retire au passage suivant
      }
    }

    rapport.push({ source: src.name, annonces: totalExtrait, retirees, erreur });
  }

  await browser.close();

  const lignes = rapport.map(
    (r) => `- ${r.source}: ${r.annonces} annonce(s), ${r.retirees} retirée(s)${r.erreur ? " — ERREUR: " + r.erreur : ""}`
  );
  fs.mkdirSync("diagnostics", { recursive: true });
  fs.writeFileSync(
    "diagnostics/last-collect.md",
    `# Collecte\n\nExécuté le ${new Date().toISOString()}\n\n${lignes.join("\n")}\n`
  );
}

main().catch((e) => {
  console.error(e);
  fs.mkdirSync("diagnostics", { recursive: true });
  fs.writeFileSync("diagnostics/last-collect.md", `# Collecte\n\nÉchec : ${String(e && e.message ? e.message : e)}\n`);
  process.exit(1);
});

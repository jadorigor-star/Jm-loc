// jm-loc — Worker minimal
//
// Règle qui prime sur tout : aucun traitement lourd ici (plan gratuit :
// 50 sous-requêtes externes, 1000 sous-requêtes Cloudflare, 10ms CPU par
// invocation). Le téléchargement des pages et le gros du calcul se font
// depuis GitHub Actions ; ce Worker ingère, stocke, sert l'API et les
// fichiers statiques (public/).

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function espaceDe(request, url) {
  const brut =
    (request.headers && request.headers.get("x-espace")) ||
    (url.searchParams && url.searchParams.get("espace")) ||
    "";
  const propre = String(brut).toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
  return propre || "principal";
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const db = env.DB;
    const espace = espaceDe(request, url);

    try {
      // --- Santé / diagnostic minimal, utile dès le premier déploiement ---
      if (url.pathname === "/api/health") {
        const row = await db.prepare("SELECT COUNT(*) AS n FROM sources").all();
        return json({ ok: true, sources: row.results[0].n, deployed_at: new Date().toISOString() });
      }

      // --- Ingestion brute depuis GitHub Actions (une route, réutilisée du projet vente) ---
      if (url.pathname === "/api/ingest-raw" && request.method === "POST") {
        const body = await request.json();
        // Extraction spécifique aux sources : à construire avec la première
        // source de bout en bout (section 9, étape 4). Pour l'instant on
        // journalise la capture pour pouvoir la sonder, sans extraire.
        try {
          await db
            .prepare(
              "INSERT INTO debug_captures (source_name, url, html, captured_at) VALUES (?,?,?,?) " +
                "ON CONFLICT(source_name) DO UPDATE SET url=excluded.url, html=excluded.html, captured_at=excluded.captured_at"
            )
            .bind(body.source_name || "inconnue", body.url || "", String(body.html || "").slice(0, 300000), new Date().toISOString())
            .run();
        } catch (e) {
          return json({ ok: false, stage: "debug_capture", error: String(e && e.message ? e.message : e) }, 500);
        }
        return json({ ok: true, note: "capture enregistrée, extraction non encore implémentée" });
      }

      // --- Préférences (critères de recherche) ---
      if (url.pathname === "/api/preferences" && request.method === "GET") {
        const res = await db.prepare("SELECT * FROM preferences WHERE espace_id=?").bind(espace).all();
        if (!res.results[0]) {
          await db.prepare("INSERT INTO preferences (espace_id) VALUES (?)").bind(espace).run();
          const again = await db.prepare("SELECT * FROM preferences WHERE espace_id=?").bind(espace).all();
          return json(again.results[0]);
        }
        return json(res.results[0]);
      }

      if (url.pathname === "/api/preferences" && request.method === "POST") {
        const body = await request.json();
        await db
          .prepare(
            "UPDATE preferences SET loyer_max=?, charges_incluses_dans_max=?, pieces_min=?, date_entree=?, communes_exclues_json=?, meuble_accepte=?, animaux_requis=? WHERE espace_id=?"
          )
          .bind(
            body.loyer_max,
            body.charges_incluses_dans_max ? 1 : 0,
            body.pieces_min,
            body.date_entree,
            JSON.stringify(body.communes_exclues || []),
            body.meuble_accepte ? 1 : 0,
            body.animaux_requis || "petits_ok",
            espace
          )
          .run();
        return json({ ok: true });
      }

      // --- Catalogue de sources testées (section 8 : ne jamais reperdre le savoir sur une source) ---
      if (url.pathname === "/api/sources" && request.method === "GET") {
        const res = await db.prepare("SELECT * FROM sources ORDER BY name").all();
        return json(res.results);
      }

      if (url.pathname === "/api/sources" && request.method === "POST") {
        const body = await request.json();
        await db
          .prepare(
            "INSERT INTO sources (name, portal, base_url, config_json, enabled, state, verdict, tested_at) VALUES (?,?,?,?,?,?,?,?) " +
              "ON CONFLICT(name) DO UPDATE SET portal=excluded.portal, base_url=excluded.base_url, config_json=excluded.config_json, enabled=excluded.enabled, verdict=excluded.verdict, tested_at=excluded.tested_at"
          )
          .bind(
            body.name,
            body.portal || null,
            body.base_url || null,
            JSON.stringify(body.config || {}),
            body.enabled ? 1 : 0,
            body.state || "nouvelle",
            body.verdict || null,
            new Date().toISOString()
          )
          .run();
        return json({ ok: true });
      }

      if (url.pathname === "/api/stats") {
        const st = await db
          .prepare(
            "SELECT (SELECT COUNT(*) FROM listings WHERE status='active') AS annonces_actives, " +
              "(SELECT COUNT(*) FROM biens) AS biens, " +
              "(SELECT COUNT(*) FROM sources WHERE enabled=1) AS sources_actives, " +
              "(SELECT COUNT(*) FROM sources WHERE enabled=1 AND state='productive') AS sources_productives, " +
              "(SELECT MAX(last_checked) FROM sources WHERE enabled=1) AS derniere_collecte"
          )
          .all();
        return json(st.results[0]);
      }

      // --- Tout le reste : fichiers statiques (interface) ---
      return env.ASSETS.fetch(request);
    } catch (e) {
      return json({ ok: false, error: String(e && e.message ? e.message : e), stack: e && e.stack }, 500);
    }
  },
};

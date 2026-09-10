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

function decodeEntities(s) {
  return s.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\\\//g, "/");
}

// Extraction pour Immostreet : chaque annonce porte un attribut
// data-bookmark-data en JSON (ville, prix, lien réel vers homegate.ch...),
// complété par le texte visible juste après (adresse, pièces, surface).
// Structure vérifiée sur une vraie capture le 10.09.2026, pas devinée.
function extraireImmostreet(html) {
  const resultats = [];
  const re = /data-bookmark-id="(\d+)" data-bookmark-data="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    let data;
    try {
      data = JSON.parse(decodeEntities(m[2]));
    } catch (e) {
      continue;
    }
    const fenetre = html.slice(m.index, m.index + 2500);
    const locMatch = fenetre.match(/<div class="location">([^<]+)<\/div>/);
    const roomsMatch = fenetre.match(/<li class="item -muted">([\d.,]+)\s*Pi[eè]ces<\/li>/);
    const surfaceMatch = fenetre.match(/<li class="item -muted">(\d+)\s*m<sup>2<\/sup>/);
    const titleMatch = fenetre.match(/<h2 class="title">([^<]+)<\/h2>/);

    resultats.push({
      external_id: m[1],
      url: (data.link || "").replace(/^href:/, ""),
      image: (data.thumbnail || "").replace(/^src:/, ""),
      title: titleMatch ? titleMatch[1].trim() : data.headline || "",
      address: locMatch ? locMatch[1].trim() : data.headline || "",
      locality: data.city || null,
      zip: data.zip || null,
      loyer_brut: typeof data.price === "number" ? data.price : null,
      rooms: roomsMatch ? parseFloat(roomsMatch[1].replace(",", ".")) : null,
      surface: surfaceMatch ? parseFloat(surfaceMatch[1]) : null,
    });
  }
  return resultats;
}

// Clé de dédoublonnage : jamais dérivée d'une seule valeur partageable
// (URL de repli) — cf. bug vécu sur le projet vente. On préfère
// localité+pièces+surface ; le repli utilise source+identifiant interne,
// jamais l'URL seule.
// Extraction générique pour les agences utilisant la plateforme Apimo
// (répandue chez les régies romandes) : chaque annonce est un lien <a>
// suivi d'un prix "heading-4", de badges type/pièces/surface, et d'une
// localité en "opacity-80". Vérifié sur Comptoir Immobilier le 10.09.2026 ;
// à réutiliser tel quel pour toute autre régie détectée sur Apimo.
function extraireApimo(html) {
  const resultats = [];
  const rePrix = /<div class="heading-4">CHF ([\d'.,]+)\.-\s*\/\s*mois<\/div>/g;
  let m;
  while ((m = rePrix.exec(html)) !== null) {
    const avant = html.slice(Math.max(0, m.index - 700), m.index);
    const apres = html.slice(m.index, m.index + 900);
    const hrefs = [...avant.matchAll(/<a href="([^"]+)">/g)];
    const url = hrefs.length ? hrefs[hrefs.length - 1][1] : null;
    const titreMatch = apres.match(/<h2[^>]*>\s*<div>([^<]+)<\/div>/);
    const piecesMatch = apres.match(/([\d.,]+)\s*pi[eè]ces</);
    const surfaceMatch = apres.match(/(\d+)\s*m<sup>2<\/sup>/);
    const localiteMatch = apres.match(/<div class="mt-3 opacity-80">([^<]+)<\/div>/);

    resultats.push({
      external_id: url ? url.replace(/\/$/, "").split("/").pop() : String(m.index),
      url,
      title: titreMatch ? titreMatch[1].trim() : "",
      loyer_brut: parseFloat(m[1].replace(/'/g, "").replace(",", ".")),
      rooms: piecesMatch ? parseFloat(piecesMatch[1].replace(",", ".")) : null,
      surface: surfaceMatch ? parseFloat(surfaceMatch[1]) : null,
      locality: localiteMatch ? localiteMatch[1].split(",")[0].trim() : null,
      address: localiteMatch ? localiteMatch[1].trim() : null,
      image: null,
    });
  }
  return resultats;
}

function bienKey(locality, rooms, surface, sourceId, externalId) {
  if (locality && rooms != null && surface != null) {
    return `${locality.toLowerCase()}|appartement|${rooms}|${surface}`;
  }
  return `repli:${sourceId}:${externalId}`;
}

async function stockerAnnonce(db, sourceId, item) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO listings (source_id, external_id, url, title, image_url, locality, loyer_brut, rooms, surface, address, status, first_seen, last_seen)
       VALUES (?,?,?,?,?,?,?,?,?,?,'active',?,?)
       ON CONFLICT(source_id, external_id) DO UPDATE SET
         url=excluded.url, title=excluded.title, image_url=excluded.image_url,
         locality=excluded.locality, loyer_brut=excluded.loyer_brut, rooms=excluded.rooms,
         surface=excluded.surface, address=excluded.address, status='active', last_seen=excluded.last_seen, missing_since=NULL`
    )
    .bind(
      sourceId, item.external_id, item.url, item.title, item.image,
      item.locality, item.loyer_brut, item.rooms, item.surface, item.address,
      now, now
    )
    .run();

  const key = bienKey(item.locality, item.rooms, item.surface, sourceId, item.external_id);
  const loyerM2 = item.surface && item.loyer_brut ? item.loyer_brut / item.surface : null;
  const listingRow = await db
    .prepare("SELECT id FROM listings WHERE source_id=? AND external_id=?")
    .bind(sourceId, item.external_id)
    .all();
  const listingId = listingRow.results[0] && listingRow.results[0].id;

  await db
    .prepare(
      `INSERT INTO biens (id, locality, type, rooms, surface, best_listing_id, loyer_m2, status, last_updated)
       VALUES (?,?,?,?,?,?,?,'actif',?)
       ON CONFLICT(id) DO UPDATE SET
         locality=excluded.locality, rooms=excluded.rooms, surface=excluded.surface,
         best_listing_id=excluded.best_listing_id, loyer_m2=excluded.loyer_m2, status='actif', last_updated=excluded.last_updated`
    )
    .bind(key, item.locality, "appartement", item.rooms, item.surface, listingId, loyerM2, now)
    .run();
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
        const sourceName = body.source_name || "inconnue";
        const html = String(body.html || "");

        try {
          await db
            .prepare(
              "INSERT INTO debug_captures (source_name, url, html, captured_at) VALUES (?,?,?,?) " +
                "ON CONFLICT(source_name) DO UPDATE SET url=excluded.url, html=excluded.html, captured_at=excluded.captured_at"
            )
            .bind(sourceName, body.url || "", html.slice(0, 900000), new Date().toISOString())
            .run();
        } catch (e) {
          return json({ ok: false, stage: "debug_capture", error: String(e && e.message ? e.message : e) }, 500);
        }

        const srcRes = await db.prepare("SELECT * FROM sources WHERE name=?").bind(sourceName).all();
        const source = srcRes.results[0];
        if (!source) {
          return json({ ok: true, note: "source inconnue, capture enregistrée seulement" });
        }

        let config = {};
        try {
          config = JSON.parse(source.config_json || "{}");
        } catch (e) {}

        let items = [];
        if (config.adapter === "immostreet_bookmark") {
          items = extraireImmostreet(html);
        } else if (config.adapter === "apimo_card") {
          items = extraireApimo(html);
        }

        for (const item of items) {
          try {
            await stockerAnnonce(db, source.id, item);
          } catch (e) {
            // on continue les autres annonces même si une échoue
          }
        }

        await db
          .prepare(
            "UPDATE sources SET last_checked=?, last_productive_count=?, state=?, last_error=NULL WHERE id=?"
          )
          .bind(
            new Date().toISOString(),
            items.length,
            items.length > 0 ? "productive" : "accessible_sans_extraction",
            source.id
          )
          .run();

        return json({ ok: true, source: sourceName, annonces_extraites: items.length });
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

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
  const correspondances = [];
  let m;
  while ((m = re.exec(html)) !== null) correspondances.push(m);

  for (let i = 0; i < correspondances.length; i++) {
    const courant = correspondances[i];
    let data;
    try {
      data = JSON.parse(decodeEntities(courant[2]));
    } catch (e) {
      continue;
    }
    // Fenêtre strictement bornée par le début de l'annonce suivante — jamais
    // au-delà, pour ne pas piocher les pièces/surface d'une autre annonce.
    const fin = i + 1 < correspondances.length ? correspondances[i + 1].index : html.length;
    const fenetre = html.slice(courant.index, fin);

    const locMatch = fenetre.match(/<div class="location">([^<]+)<\/div>/);
    const titleMatch = fenetre.match(/<h2 class="title">([^<]+)<\/h2>/);

    // Deux sources indépendantes pour pièces/surface : la liste courte
    // (attributesshort) et le bloc explicite clé/valeur (results-attributes).
    // On préfère le bloc explicite, plus fiable, et on ne garde la liste
    // courte qu'en repli.
    const roomsCourt = fenetre.match(/<li class="item -muted">([\d.,]+)\s*Pi[eè]ces<\/li>/);
    const surfaceCourt = fenetre.match(/<li class="item -muted">(\d+)\s*m<sup>2<\/sup>/);
    const roomsExplicite = fenetre.match(/<span class="key">Pi[eè]ces<\/span>\s*<span class="value">([\d.,]+)<\/span>/);
    const surfaceExplicite = fenetre.match(/<span class="key">Surf\. habitable<\/span>\s*<span class="value">(\d+)\s*m/);

    let rooms = roomsExplicite ? parseFloat(roomsExplicite[1].replace(",", ".")) : (roomsCourt ? parseFloat(roomsCourt[1].replace(",", ".")) : null);
    let surface = surfaceExplicite ? parseFloat(surfaceExplicite[1]) : (surfaceCourt ? parseFloat(surfaceCourt[1]) : null);

    // Prix : celui réellement affiché à l'écran (span "amount") prime sur
    // le prix embarqué dans le JSON du bouton favori, qui peut diverger.
    const prixVisible = fenetre.match(/<span class="amount">([\d'.,]+)<\/span>/);
    let loyer = prixVisible
      ? parseFloat(prixVisible[1].replace(/'/g, "").replace(",", "."))
      : (typeof data.price === "number" ? data.price : null);

    // Garde-fou : un prix au m² invraisemblable (>150 CHF/m²/mois, ce qui
    // couvre déjà le très haut de gamme genevois) signale une donnée
    // mal appariée plutôt qu'une vraie annonce de luxe — on garde le prix,
    // mais on efface la surface/pièces non fiables plutôt que de publier
    // un chiffre trompeur.
    if (surface && loyer && loyer / surface > 150) { surface = null; }
    if (rooms != null && loyer != null && loyer > 8000 && rooms <= 2) { rooms = null; }

    resultats.push({
      external_id: courant[1],
      url: (data.link || "").replace(/^href:/, ""),
      image: (data.thumbnail || "").replace(/^src:/, ""),
      title: titleMatch ? titleMatch[1].trim() : data.headline || "",
      address: locMatch ? locMatch[1].trim() : data.headline || "",
      locality: data.city || null,
      zip: data.zip || null,
      loyer_brut: loyer,
      rooms: rooms,
      surface: surface,
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

// Extraction pour Les Régisseurs Associés : cartes WordPress avec classes
// city/type/surface/rooms/price. Vérifié le 10.09.2026.
function extraireRegisseurs(html) {
  const resultats = [];
  const reBloc = /<a href="([^"]+)" class="item" title="([^"]*)">([\s\S]*?)<\/a>/g;
  let m;
  while ((m = reBloc.exec(html)) !== null) {
    if (!/location-appartement|location-maison/.test(m[1])) continue;
    const bloc = m[3];
    const cityMatch = bloc.match(/<span class="city">([^<]+)<\/span>/);
    const surfaceMatch = bloc.match(/<span class="surface">(\d+)m<sup>2<\/sup><\/span>/);
    const roomsMatch = bloc.match(/<span class="rooms">\s*([\d.,]+)\s*pi[eè]ces/);
    const priceMatch = bloc.match(/<span class="price">\s*([\d',.]+)\s*CHF/);

    resultats.push({
      external_id: (m[1].match(/(\d+)\/?$/) || [, String(m.index)])[1],
      url: m[1],
      title: m[2],
      locality: cityMatch ? cityMatch[1].trim() : null,
      address: cityMatch ? cityMatch[1].trim() : null,
      surface: surfaceMatch ? parseFloat(surfaceMatch[1]) : null,
      rooms: roomsMatch ? parseFloat(roomsMatch[1].replace(",", ".")) : null,
      loyer_brut: priceMatch ? parseFloat(priceMatch[1].replace(/'/g, "")) : null,
      image: null,
    });
  }
  return resultats;
}

// Extraction pour Rosset (plateforme ImmoMig) : cartes avec classes
// caract_location/caract_price/caract_surface/caract_rooms. Vérifié 11.09.2026.
function extraireRosset(html) {
  var resultats = [];
  var re = /<a class="box_inner box_inner_link" href="([^"]+)"/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    if (!/a-louer-appartement|a-louer-maison/.test(m[1])) continue;
    var bloc = html.slice(m.index, m.index + 4000);
    var titleMatch = bloc.match(/<div class="h2">([^<]+)<\/div>/);
    var locMatch = bloc.match(/caract_location[\s\S]{0,400}?<div class="value">\s*([^<]+?)\s*<\/div>/);
    var priceMatch = bloc.match(/caract_price[\s\S]{0,400}?CHF&nbsp;([\d'.,]+)\.-\s*\/mois/);
    var surfaceMatch = bloc.match(/caract_surface[\s\S]{0,500}?<span class="value">~?\s*(\d+)\s*m/);
    var roomsMatch = bloc.match(/caract_rooms[\s\S]{0,500}?<span class="value">([\d.,]+)<\/span>/);
    var idMatch = m[1].match(/-(\d+)\??/);

    resultats.push({
      external_id: idMatch ? idMatch[1] : String(m.index),
      url: "https://immo.rosset.ch" + m[1].replace(/&amp;/g, "&"),
      title: titleMatch ? titleMatch[1].trim() : "",
      locality: locMatch ? locMatch[1].trim() : null,
      address: locMatch ? locMatch[1].trim() : null,
      loyer_brut: priceMatch ? parseFloat(priceMatch[1].replace(/'/g, "").replace(",", ".")) : null,
      surface: surfaceMatch ? parseFloat(surfaceMatch[1]) : null,
      rooms: roomsMatch ? parseFloat(roomsMatch[1].replace(",", ".")) : null,
      image: null,
    });
  }
  return resultats;
}

// Extraction pour Régie Foncière : site PHP maison, cartes "objetbox".
// Vérifié 11.09.2026.
function extraireRegieFonciere(html) {
  var resultats = [];
  var re = /<a href="(\/layout\/objets_details\.php\?objet_id=\d+[^"]*)"[^>]*class="[^"]*"[\s\S]{0,400}?<div class="objetbox_infos">([\s\S]{0,600}?)<\/div>/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var bloc = m[2];
    var villeMatch = bloc.match(/<h2[^>]*>([^<]+)<\/h2>/);
    var piecesMatch = bloc.match(/([\d.,]+)\s*pi[eè]ces?/i);
    var surfaceMatch = bloc.match(/(?:\d+\s*(?:&lt;|<)\s*)?(\d+)\s*m<sup>2<\/sup>/);
    var prixMatch = bloc.match(/class="prix">CHF ([\d'.,]+)\.-/);
    var idMatch = m[1].match(/objet_id=(\d+)/);

    resultats.push({
      external_id: idMatch ? idMatch[1] : String(m.index),
      url: "https://regiefonciere.ch" + m[1].replace(/&amp;/g, "&"),
      title: villeMatch ? villeMatch[1].trim() : "",
      locality: villeMatch ? villeMatch[1].trim() : null,
      address: villeMatch ? villeMatch[1].trim() : null,
      loyer_brut: prixMatch ? parseFloat(prixMatch[1].replace(/'/g, "").replace(",", ".")) : null,
      surface: surfaceMatch ? parseFloat(surfaceMatch[1]) : null,
      rooms: piecesMatch ? parseFloat(piecesMatch[1].replace(",", ".")) : null,
      image: null,
    });
  }
  return resultats;
}

// Un bien = une annonce, par défaut. La clé fine (localité+pièces+surface)
// a été essayée pour fusionner un même bien publié sur plusieurs sources,
// mais elle fusionnait à tort des annonces différentes qui partageaient
// juste des chiffres arrondis (ex. quatre appartements "1 pièce, 130 m²"
// à des adresses différentes, réduits à une seule fiche visible — perte
// de données, pas un doublon résolu). Tant qu'un rapprochement plus fin
// (adresse, prix) n'est pas construit, on préfère ne jamais rien cacher.
function bienKey(locality, rooms, surface, sourceId, externalId) {
  return `repli:${sourceId}:${externalId}`;
}

// Point unique d'aiguillage extraction → stockage, réutilisé par
// /api/ingest-raw (collecte normale) et /api/reprocess (retraitement forcé,
// section 8 de l'amorçage : "prévoir dès le début un moyen de retraiter
// les données existantes").
async function extraireEtStocker(db, source, html) {
  let config = {};
  try {
    config = JSON.parse(source.config_json || "{}");
  } catch (e) {}

  let items = [];
  if (config.adapter === "immostreet_bookmark") items = extraireImmostreet(html);
  else if (config.adapter === "apimo_card") items = extraireApimo(html);
  else if (config.adapter === "regisseurs_wp_card") items = extraireRegisseurs(html);
  else if (config.adapter === "rosset_immomig") items = extraireRosset(html);
  else if (config.adapter === "regiefonciere_card") items = extraireRegieFonciere(html);

  for (const item of items) {
    try {
      await stockerAnnonce(db, source.id, item);
    } catch (e) {
      // on continue les autres annonces même si une échoue
    }
  }
  return items.length;
}

async function stockerAnnonce(db, sourceId, item) {
  const now = new Date().toISOString();
  const key = bienKey(item.locality, item.rooms, item.surface, sourceId, item.external_id);
  const loyerM2 = item.surface && item.loyer_brut ? item.loyer_brut / item.surface : null;

  await db
    .prepare(
      `INSERT INTO listings (source_id, external_id, url, title, image_url, locality, loyer_brut, rooms, surface, address, status, bien_id, first_seen, last_seen)
       VALUES (?,?,?,?,?,?,?,?,?,?,'active',?,?,?)
       ON CONFLICT(source_id, external_id) DO UPDATE SET
         url=excluded.url, title=excluded.title, image_url=excluded.image_url,
         locality=excluded.locality, loyer_brut=excluded.loyer_brut, rooms=excluded.rooms,
         surface=excluded.surface, address=excluded.address, status='active', bien_id=excluded.bien_id,
         last_seen=excluded.last_seen, missing_since=NULL`
    )
    .bind(
      sourceId, item.external_id, item.url, item.title, item.image,
      item.locality, item.loyer_brut, item.rooms, item.surface, item.address,
      key, now, now
    )
    .run();

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

        // Clé de capture : nom de source + URL, pour que les pages
        // successives d'une même source (pagination) ne s'écrasent pas
        // entre elles — sans quoi le diagnostic après coup est impossible.
        const cleCapture = sourceName + " :: " + (body.url || "");
        try {
          await db
            .prepare(
              "INSERT INTO debug_captures (source_name, url, html, captured_at) VALUES (?,?,?,?) " +
                "ON CONFLICT(source_name) DO UPDATE SET url=excluded.url, html=excluded.html, captured_at=excluded.captured_at"
            )
            .bind(cleCapture, body.url || "", html.slice(0, 900000), new Date().toISOString())
            .run();
        } catch (e) {
          return json({ ok: false, stage: "debug_capture", error: String(e && e.message ? e.message : e) }, 500);
        }

        const srcRes = await db.prepare("SELECT * FROM sources WHERE name=?").bind(sourceName).all();
        const source = srcRes.results[0];
        if (!source) {
          return json({ ok: true, note: "source inconnue, capture enregistrée seulement" });
        }

        const nbAnnonces = await extraireEtStocker(db, source, html);

        await db
          .prepare(
            "UPDATE sources SET last_checked=?, last_productive_count=?, state=?, last_error=NULL WHERE id=?"
          )
          .bind(
            new Date().toISOString(),
            nbAnnonces,
            nbAnnonces > 0 ? "productive" : "accessible_sans_extraction",
            source.id
          )
          .run();

        return json({ ok: true, source: sourceName, source_id: source.id, annonces_extraites: nbAnnonces });
      }

      // --- Retraitement forcé, sans re-télécharger : rejoue l'extraction sur
      // les dernières captures déjà en base. Corrige le stock existant dès
      // qu'un extracteur est amélioré, sans attendre le prochain passage de
      // collecte (section 8 de l'amorçage). ---
      if (url.pathname === "/api/reprocess" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const nomSource = body.source_name;
        if (!nomSource) return json({ ok: false, error: "source_name requis" }, 400);

        const srcRes = await db.prepare("SELECT * FROM sources WHERE name=?").bind(nomSource).all();
        const source = srcRes.results[0];
        if (!source) return json({ ok: false, error: "source inconnue" }, 404);

        const capturesRes = await db
          .prepare("SELECT html FROM debug_captures WHERE source_name LIKE ?")
          .bind(nomSource + " :: %")
          .all();

        let total = 0;
        for (const row of capturesRes.results) {
          total += await extraireEtStocker(db, source, row.html);
        }

        return json({ ok: true, source: nomSource, pages_retraitees: capturesRes.results.length, annonces_extraites: total });
      }

      // --- Finalisation d'une collecte : marque "removed" tout ce qui
      // n'a pas été revu pendant ce passage — une seule absence suffit en
      // location (section 6 de l'amorçage, contrairement à la vente qui
      // tolérait deux absences). Appelé par collect.js après avoir parcouru
      // toutes les pages d'une source. ---
      if (url.pathname === "/api/finaliser-collecte" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const nomSource = body.source_name;
        const depuis = body.depuis;
        if (!nomSource || !depuis) return json({ ok: false, error: "source_name et depuis requis" }, 400);

        const srcRes = await db.prepare("SELECT id FROM sources WHERE name=?").bind(nomSource).all();
        const source = srcRes.results[0];
        if (!source) return json({ ok: false, error: "source inconnue" }, 404);

        const res = await db
          .prepare(
            "UPDATE listings SET status='removed', missing_since=? WHERE source_id=? AND status='active' AND last_seen<?"
          )
          .bind(new Date().toISOString(), source.id, depuis)
          .run();

        return json({ ok: true, source: nomSource, annonces_retirees: res.meta.changes });
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
            "UPDATE preferences SET loyer_max=?, charges_incluses_dans_max=?, pieces_min=?, date_entree=?, communes_exclues_json=?, meuble_accepte=?, animaux_requis=?, email=?, alertes_actives=? WHERE espace_id=?"
          )
          .bind(
            body.loyer_max,
            body.charges_incluses_dans_max ? 1 : 0,
            body.pieces_min,
            body.date_entree,
            JSON.stringify(body.communes_exclues || []),
            body.meuble_accepte ? 1 : 0,
            body.animaux_requis || "petits_ok",
            body.email || null,
            body.alertes_actives ? 1 : 0,
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

      // --- Biens actifs, pour l'interface ---
      if (url.pathname === "/api/biens" && request.method === "GET") {
        const res = await db
          .prepare(
            `SELECT b.id as bien_id, b.locality, b.rooms, b.surface, b.loyer_m2, b.last_updated,
                    l.title, l.url, l.loyer_brut, l.image_url, l.address, s.name as source
             FROM biens b
             LEFT JOIN listings l ON l.id = b.best_listing_id
             LEFT JOIN sources s ON s.id = l.source_id
             WHERE b.status='actif' AND l.status='active'
             ORDER BY l.first_seen DESC
             LIMIT 500`
          )
          .all();
        return json(res.results);
      }

      if (url.pathname === "/api/favoris" && request.method === "GET") {
        const res = await db.prepare("SELECT bien_id FROM favoris WHERE espace_id=?").bind(espace).all();
        return json(res.results.map((r) => r.bien_id));
      }

      if (url.pathname === "/api/favoris" && request.method === "POST") {
        const body = await request.json();
        if (body.retirer) {
          await db.prepare("DELETE FROM favoris WHERE espace_id=? AND bien_id=?").bind(espace, body.bien_id).run();
        } else {
          await db
            .prepare("INSERT INTO favoris (espace_id, bien_id) VALUES (?,?) ON CONFLICT(espace_id, bien_id) DO NOTHING")
            .bind(espace, body.bien_id)
            .run();
        }
        return json({ ok: true });
      }

      if (url.pathname === "/api/discarded" && request.method === "GET") {
        const res = await db.prepare("SELECT bien_id FROM discarded WHERE espace_id=?").bind(espace).all();
        return json(res.results.map((r) => r.bien_id));
      }

      if (url.pathname === "/api/discarded" && request.method === "POST") {
        const body = await request.json();
        if (body.retirer) {
          await db.prepare("DELETE FROM discarded WHERE espace_id=? AND bien_id=?").bind(espace, body.bien_id).run();
        } else {
          await db
            .prepare("INSERT INTO discarded (espace_id, bien_id) VALUES (?,?) ON CONFLICT(espace_id, bien_id) DO NOTHING")
            .bind(espace, body.bien_id)
            .run();
        }
        return json({ ok: true });
      }

      // --- Alertes : calcule les nouveaux biens correspondant aux critères
      // de chaque espace ayant activé les alertes, et les marque comme
      // envoyés. Section 6 de l'amorçage : "l'alerte est le produit, pas
      // un confort". Le réel envoi d'e-mail est fait par l'appelant
      // (GitHub Actions), cette route ne fait que calculer et journaliser.
      if (url.pathname === "/api/alertes/verifier" && request.method === "POST") {
        const prefsRes = await db
          .prepare("SELECT * FROM preferences WHERE alertes_actives=1 AND email IS NOT NULL AND email != ''")
          .all();
        const sortie = [];

        for (const pref of prefsRes.results) {
          let exclues = [];
          try {
            exclues = JSON.parse(pref.communes_exclues_json || "[]");
          } catch (e) {}

          const biensRes = await db
            .prepare(
              `SELECT b.id as bien_id, b.locality, b.rooms, b.surface, l.title, l.url, l.loyer_brut, s.name as source
               FROM biens b
               LEFT JOIN listings l ON l.id = b.best_listing_id
               LEFT JOIN sources s ON s.id = l.source_id
               WHERE b.status='actif' AND l.status='active'
                 AND (l.loyer_brut IS NULL OR l.loyer_brut <= ?)
                 AND (b.rooms IS NULL OR b.rooms >= ?)
                 AND NOT EXISTS (SELECT 1 FROM alerts_log a WHERE a.espace_id=? AND a.bien_id=b.id)`
            )
            .bind(pref.loyer_max || 999999999, pref.pieces_min || 0, pref.espace_id)
            .all();

          const nouveaux = biensRes.results.filter((b) => !exclues.includes(b.locality));

          for (const b of nouveaux) {
            await db
              .prepare(
                "INSERT INTO alerts_log (espace_id, bien_id, channel) VALUES (?,?,'email') ON CONFLICT(espace_id, bien_id) DO NOTHING"
              )
              .bind(pref.espace_id, b.bien_id)
              .run();
          }

          if (nouveaux.length > 0) {
            sortie.push({ espace_id: pref.espace_id, email: pref.email, nouveaux });
          }
        }

        return json(sortie);
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

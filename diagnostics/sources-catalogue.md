# Catalogue de sources testées

Consigner chaque agence/portail sondé, même inexploitable, avec date et verdict.
Verdicts possibles : `productive`, `accessible` (répond mais rien extrait), `js_only`
(rendu JavaScript requis), `prix_sur_demande`, `bloquee` (anti-robot), `morte`.

## Sources en production

| Source | Statut | Détail |
|---|---|---|
| **Immostreet** (canton Genève, location) | ✅ **Productive** | 200 annonces/collecte (10 pages), 39 communes, extraction via `data-bookmark-data`. Mis en prod le 10.09.2026. |


| Source | Portail | Date sondée | Verdict | Notes |
|---|---|---|---|---|
| Livit SA | immoscout24 | à sonder | candidate | Régie nationale, active à Genève. Insérée en base (désactivée), config adaptée `RENT`. Champs loyer non vérifiés — à confirmer par sonde. |
| PRIVERA AG | immoscout24 | à sonder | candidate | Régie nationale, active à Genève. Insérée en base (désactivée), config adaptée `RENT`. |
| Fiduciaria Cheda SA | immoscout24 | 05.09 (côté vente) | hors périmètre probable | Fiduciaire tessinoise. Non insérée en base — à reconsidérer si portefeuille genevois confirmé. |
| Colombo Fiduciaria SA | immoscout24 | 05.09 (côté vente) | hors périmètre probable | Tessin. Non insérée. |
| Alloggi Ticino SA | immoscout24 | 05.09 (côté vente) | hors périmètre probable | Tessin. Non insérée. |
| Bulliard Immobilier SA | immoscout24 | 05.09 (côté vente) | hors périmètre probable | Fribourg. Non insérée. |
| Fiduciaria Cheda SA (doublon IS24) | immoscout24 | 05.09 (côté vente) | doublon | Même agence que ci-dessus, deux fiches côté vente. |

## Régies et agences (à tester une par une, phase suivante)

Source : annuaire officiel de l'USPI Genève (uspi-ge.ch/membres/), l'association professionnelle qui regroupe les régies gérant ~70% du parc locatif genevois. Complété par quelques grandes régies non-membres actives à Genève.

Ces 36 entrées sont chargées dans la table `sources` de `jm-loc` (portal='agence_directe', state='a_sonder', enabled=0), prêtes à être sondées puis classées comme dans jm-immo-cl (accessible / bloquée / sans bien à louer / JS requis / morte).

### Membres USPI Genève (35)
| Régie | Site |
|---|---|
| Agence Immobilière Bersier & Cie SA | bersiersa.ch |
| Agence immobilière Gérard Paley & Fils SA | gpaley.ch |
| BAEZNER Gérard & Cie SA | regiebaezner.ch |
| BESSON, DUMONT, DELAUNAY & Cie SA | bdd.ch |
| BESUCHET Charles SA | — (pas de site recensé) |
| BORDIER & SCHMIDHAUSER SA | bordier-schmidhauser.ch |
| BORY & Cie Agence Immobilière SA | bory.ch |
| BRUN ÉDOUARD & Cie SA | regiebrun.ch |
| BURGER RODOLPHE SA | burger-sa.ch |
| COFIMOB SA | — (pas de site recensé) |
| COGERIM Société Coopérative | cogerim.ch |
| COMPTOIR IMMOBILIER SA | comptoir-immo.ch |
| DAUDIN & Cie SA | daudin.ch |
| GEROFINANCE – RÉGIE DU RHÔNE SA | gerofinance.ch |
| GRANGE IMMOBILIER SA | grange.ch |
| IMMOCEP | immocep.ch |
| IMRO – Immobilière Romande SA | imro.ch |
| JOUAN – DE RHAM TRANSACTIONS SA | jouan-derham.ch |
| LEMANIA IMMO SA | lemania-immo.ch |
| LES RÉGISSEURS ASSOCIÉS SA | regisseurs.ch |
| MELCARNE SA | melcarne.ch |
| MOSER VERNET & Cie SA | moservernet.ch |
| MOSER VERNET & CIE, Valorisations Immobilières SA | move-properties.ch |
| NAEF IMMOBILIER Genève SA | naef.ch |
| PILET & RENAUD SA | pilet-renaud.ch |
| PILET & RENAUD TRANSACTIONS SA | pilet-renaud.ch |
| PRIVALIA IMMOBILIER SA | privalia.ch |
| RÉGIE DU CENTRE SA | regieducentre.ch |
| RÉGIE DU MAIL, Flavio Brisotto | regies.ch |
| RÉGIE FONCIÈRE SA | regiefonciere.ch |
| RÉGIE TOURNIER SA | tournier.ch |
| ROSSET & Cie SA | rosset.ch |
| SPG | spg.ch |
| STOFFEL IMMOBILIER SA | stoffelimmo.ch |
| VERBEL Genève SA | verbel.ch |

### Grandes régies non-membres USPI, actives à Genève (1 confirmée + 2 déjà sondées)
| Régie | Site | Statut |
|---|---|---|
| Wincasa SA | wincasa.ch | à sonder |
| Livit SA | livit.ch | sondée — 0 annonce au 10.09.2026 |
| PRIVERA AG | (page IS24) | sondée — bloquée Cloudflare |

À compléter au fil des sondes : d'autres régies suisses-alémaniques actives à Genève existent probablement (ex. groupes de gestion nationaux), à ajouter si elles apparaissent dans les recherches de portails ou sur recommandation.

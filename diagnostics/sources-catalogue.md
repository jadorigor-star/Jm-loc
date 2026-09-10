# Catalogue de sources testées

Consigner chaque agence/portail sondé, même inexploitable, avec date et verdict.
Verdicts possibles : `productive`, `accessible` (répond mais rien extrait), `js_only`
(rendu JavaScript requis), `prix_sur_demande`, `bloquee` (anti-robot), `morte`.

| Source | Portail | Date sondée | Verdict | Notes |
|---|---|---|---|---|
| Livit SA | immoscout24 | à sonder | candidate | Régie nationale, active à Genève. Insérée en base (désactivée), config adaptée `RENT`. Champs loyer non vérifiés — à confirmer par sonde. |
| PRIVERA AG | immoscout24 | à sonder | candidate | Régie nationale, active à Genève. Insérée en base (désactivée), config adaptée `RENT`. |
| Fiduciaria Cheda SA | immoscout24 | 05.09 (côté vente) | hors périmètre probable | Fiduciaire tessinoise. Non insérée en base — à reconsidérer si portefeuille genevois confirmé. |
| Colombo Fiduciaria SA | immoscout24 | 05.09 (côté vente) | hors périmètre probable | Tessin. Non insérée. |
| Alloggi Ticino SA | immoscout24 | 05.09 (côté vente) | hors périmètre probable | Tessin. Non insérée. |
| Bulliard Immobilier SA | immoscout24 | 05.09 (côté vente) | hors périmètre probable | Fribourg. Non insérée. |
| Fiduciaria Cheda SA (doublon IS24) | immoscout24 | 05.09 (côté vente) | doublon | Même agence que ci-dessus, deux fiches côté vente. |

Origine : ces 7 pages étaient désactivées côté vente avec le motif « page agence sans bien à vendre » — c'est-à-dire des agences dont le catalogue IS24 ne contient que des locations, invisibles pour un scraper qui ne retient que `offerType=BUY`. Confirmé le 10.09.2026 en interrogeant directement la base `jm-immo-db`.

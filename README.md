# jm-loc

Agrégateur d'annonces de location — canton de Genève. Jumeau du projet vente
(`jm-immo-cl`), architecture Worker + D1 + GitHub Actions. Voir
`APP_LOCATION_AMORCAGE.md` pour le contexte complet.

## État

- Base D1 `jm-loc` créée, schéma appliqué (10 tables, isolation `espace_id`).
- Préférences initiales enregistrées : loyer max 2400.- + charges, dès 3
  pièces, disponibilité dans 2 mois, toutes communes genevoises (exclusions
  possibles), petits animaux tolérés.
- Worker minimal : `/api/health`, `/api/ingest-raw` (capture sans extraction
  pour l'instant), `/api/preferences`, `/api/sources`, `/api/stats`.
- Outillage en place : `deploy.yml`, `probe.yml`, `collect.yml` (toutes les
  20 min), `recette.yml`.

## Reste à faire une fois le dépôt poussé

1. Variable de dépôt `WORKER_URL` (Settings → Secrets and variables →
   Actions → Variables) — l'URL réelle du Worker déployé.
2. Secrets `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID`.
3. Première source de bout en bout, validée par `probe.yml`, consignée dans
   `diagnostics/sources-catalogue.md`.
4. Extraction réelle dans `/api/ingest-raw` (actuellement : capture brute
   seulement).
5. Alertes — en priorité, avant l'interface (section 9 de l'amorçage).

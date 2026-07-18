# Notes de Design & Spécifications Techniques

Ce dossier regroupe les spécifications et notes de design de la plateforme **Modaka**, réparties par priorité de développement pour guider l'implémentation de manière ordonnée.

---

## 🗺️ Index des Documents (Par priorité)

### 🥇 [Priorité 1 : Cœur du Système & Exécution Locale](./1_core_and_local.md)
* **Objectifs** : Découplage de la logique métier, gestion des pipelines d'ingestion agnostiques, et packaging mobile local.
* **Composants** :
  * `@quatrain/okf` (Curation et validation OKF v0.1).
  * `@quatrain/ingestion` (Adaptateurs d'OCR, d'Audio, de Vidéo et de Crawling Web).
  * `modaka` (Cœur JS sans UI ni dépendance serveur HTTP).
  * `modaka-app` (Wrapper Expo pour exécution sur smartphone avec OCR et SLM locaux).

### 🥈 [Priorité 2 : SaaS Multi-Locataires & Ingestion Curation](./2_saas_and_curation.md)
* **Objectifs** : Ajout de la multi-tenancy, authentification cloud, queues distribuées et alimentation par flux.
* **Composants** :
  * `modaka-saas` (BaaS Supabase, S3 managé, OAuth2/OIDC).
  * Intégration de `@quatrain/queue-aws` / `@quatrain/queue-amqp` (SQS/RabbitMQ).
  * `bookworm` (Application de curation de fiches OKF d'agronomie).

### 🥉 [Priorité 3 : Hey Brad & Boucle de Rétroaction](./3_white_label_and_feedback.md)
* **Objectifs** : Instance compagnon métier et boucle fermée d'optimisation IA bidirectionnelle.
* **Composants** :
  * `hey-brad` (White-label agricole s'appuyant sur `modaka-saas`).
  * Boucle de rétroaction (Métriques d'utilité et télémétrie anonymisée vers *Bookworm*).

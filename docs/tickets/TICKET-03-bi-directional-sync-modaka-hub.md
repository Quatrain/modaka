# Ticket #3: Bi-Directional Selective Sync between Modaka Edge Brain and Modaka-Hub

- **ID:** TICKET-03
- **Status:** 📋 Backlog / Specified
- **Priority:** High
- **Components:** Git Transport (`@quatrain/storage-git`), Hub Client, Conflict Resolution
- **Authors:** Quatrain Engineering Team

---

## 🎯 Objective & Business Value

Bridge personal sovereign edge nodes (`modaka`) with centralized institutional authority hubs (`modaka-hub`):
- Subscribe an edge Modaka node to upstream topic channels from Modaka-Hub (e.g., agronomy, cybersecurity, legal).
- Push locally curated concept cards or notes back to Modaka-Hub for peer review or team aggregation.
- Conflict-free merge strategy leveraging Git DAG history and OKF frontmatter revision tracking.

---

## 🏗️ Technical Architecture & Specifications

### 1. Subscription Channel Protocol
- Modaka maintains a `subscriptions.json` declaration:
  ```json
  [
    {
      "hubUrl": "https://hub.hey.brad.ag",
      "channel": "itineraries/viticulture",
      "autoPull": true
    }
  ]
  ```
- Pull mechanism: Fetch delta commits via sparse-checkout or shallow Git fetch.

### 2. Upstream Contribution Workflow
- Curators can click "Submit to Hub" on any local document card.
- Creates an export bundle containing the markdown document, relative asset attachments, and provenance signature.
- Dispatched to Modaka-Hub ingestion queue with user attribution.

---

## 📋 Acceptance Criteria

- [ ] One-click synchronization pulling latest approved concept documents from Modaka-Hub.
- [ ] Exporting local documents to a remote Modaka-Hub instance via authenticated API.

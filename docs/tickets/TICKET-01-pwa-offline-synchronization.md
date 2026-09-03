# Ticket #1: PWA Offline Mode & Resilient Background Sync with Service Workers

- **ID:** TICKET-01
- **Status:** 📋 Backlog / Specified
- **Priority:** High
- **Components:** PWA, Service Worker, Background Sync API, IndexedDB Cache
- **Authors:** Quatrain Engineering Team

---

## 🎯 Objective & Business Value

Enable complete offline mobility for knowledge workers and field researchers:
- Full read and navigation access to local OKF documents even with zero network connectivity.
- Offline note taking and queueing of voice memos or snapshot attachments.
- Seamless background synchronization to the local disk and remote Git remotes upon network recovery.

---

## 🏗️ Technical Architecture & Specifications

### 1. Progressive Web App (PWA) Manifest & Service Worker
- Register service worker using Workbox / Vite PWA plugin.
- Cache strategy:
  - Static shell (Astro components, CSS, icons): `CacheFirst`.
  - API queries (`/api/search`, `/api/document`): `StaleWhileRevalidate`.
  - Ingestion mutations (`/api/upload`): `NetworkOnly` with Background Sync fallback.

### 2. Offline Action Journal
When disconnected:
1. Serialize pending actions (new document creation, edits, tags) into client-side IndexedDB journal (`modaka_offline_mutations`).
2. Display a subtle amber status indicator: `Mode Hors-Ligne (3 actions en attente)`.
3. On `window.online` or background sync trigger, replay journal items sequentially against the local backend.

---

## 📋 Acceptance Criteria

- [ ] Application loads and allows reading existing OKF files with airplane mode enabled.
- [ ] Offline edits persist locally and sync without data loss upon reconnection.
- [ ] Lighthouse PWA score >= 90.

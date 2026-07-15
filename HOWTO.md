# Second Brain Copilot — HOWTO & Scénarios d'Usage

Ce document regroupe les procédures courantes, exemples d'utilisation et détails d'implémentation pour administrer et exploiter votre Second Brain au quotidien.

---

## 🛠️ Scénarios Courants

### 1. Configurer vos Passions et Intérêts (Catégories)
Les thèmes proposés lors du premier démarrage (onboarding) sont définis de manière statique.
* **Fichier source :** [onboarding.yaml](file:///Users/crapougnax/CODE/CRAPOUGNAX/second-brain/src/config/onboarding.yaml)
* **Format d'édition :**
  ```yaml
  themes:
    - name: "Technologie"
      subthemes:
        - "Intelligence Artificielle"
        - "Sécurité"
        - "Programmation"
    - name: "Littérature"
      subthemes:
        - "Science-Fiction"
        - "Essais"
  ```
L'accordéon de l'interface s'adaptera automatiquement lors du choix initial de l'utilisateur.

---

### 2. Importer des documents et photos depuis un mobile/tablette
* **Interface tactile :** Le menu du tableau de bord contient un onglet **"Photo / Image"**.
* **Comportement mobile :** En cliquant sur le bouton de sélection, votre système (iOS/Android) proposera automatiquement :
  1. De prendre une photo en direct avec la caméra de l'appareil.
  2. De sélectionner une image existante dans votre galerie photo.
* **Note de contexte :** Vous pouvez associer une note textuelle (ex: *"Ceci est le ticket de caisse du restaurant de ce soir"*) à votre document. Gemini combinera cette note avec l'analyse d'image pour catégoriser et résumer la note OKF de manière ultra-pertinente.

---

### 3. Exécuter une ré-indexation manuelle des fichiers `index.md`
Si vous modifiez ou déplacez manuellement des fichiers Markdown sur votre disque dans `second-brain-data/`, vous pouvez régénérer tous les fichiers d'index (`index.md`) de navigation :
1. Créez et lancez un script rapide dans l'environnement du projet :
```typescript
import { initBackend } from './src/lib/backend';
import { Backend } from '@quatrain/backend';

initBackend();
const okfAdapter = Backend.getBackend('default') as any;
// Déclenche la régénération récursive
await okfAdapter.rebuildIndices('content');
console.log("Indexation terminée !");
```

---

## 🔍 Fonctionnement du Moteur de Discussion (Chat Context)

Lorsque vous parlez au Copilote, celui-ci tente de deviner quels documents vous mentionnez dans votre question afin de charger leur texte complet dans son contexte.

### Algorithme de détection
Le fichier [chat.ts](file:///Users/crapougnax/CODE/CRAPOUGNAX/second-brain/src/pages/api/chat.ts) procède comme suit :
1. Il nettoie la question en minuscules.
2. Pour chaque document de la base, il extrait les mots de son titre de plus de 2 lettres.
3. Il exclut les mots de liaison courants (stop words) en français et en anglais :
   ```typescript
   const stopWords = new Set(['les', 'des', 'une', 'pour', 'avec', 'dans', 'the', 'and', 'for', 'sur', 'aux', 'mon', 'mes', 'ton', 'tes', 'son', 'ses', 'une', 'par', 'grace', 'dune']);
   ```
4. Si un mot clé restant du titre (ex: `"okf"`, `"privacy"`, `"crash"`) ou un tag (ex: `"markdown"`, `"specification"`) est inclus dans la question, le document entier est chargé.

---

## 📱 Adaptation Écran (Tactile)
Le CSS de l'application ([global.css](file:///Users/crapougnax/CODE/CRAPOUGNAX/second-brain/src/styles/global.css)) a été optimisé pour une expérience applicative mobile :
* `.app-container` : Limité à un `max-width: 1200px` centré pour le confort visuel sur grand écran, mais entièrement fluide sur mobile et tablette.
* `.bottom-nav` : Menu d'onglets fixé en bas de l'écran, centré et aligné sur les dimensions du viewport mobile pour une manipulation facile au pouce.

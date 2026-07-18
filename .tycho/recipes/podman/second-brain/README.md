# Second Brain Tycho Recipe

Tactile and touch-first PWA personal knowledge base powered by Astro SSR and Google Gemini.

## Deployment Details

- **Default URL**: `https://${SECONDBRAIN_SUBDOMAIN}.${DOMAIN_NAME}`
- **Required Env Variables**:
  - `SECONDBRAIN_SUBDOMAIN`: Subdomain mapping for the app routing.
  - `GEMINI_API_KEY`: API Key for Google's Gemini LLM.
- **GitHub Storage Env Variables (Optional - defaults to local Git)**:
  - `GIT_MODE`: Set to `github` to store metadata on GitHub.
  - `GIT_REPO_OWNER`: GitHub username/org owner.
  - `GIT_REPO_NAME`: GitHub repository name.
  - `GIT_BRANCH`: GitHub branch name (defaults to `main`).
  - `GIT_GITHUB_TOKEN`: GitHub Personal Access Token (PAT) with write permissions.

## Storage Persistence

Data is isolated and persisted on the remote host at:
- Metadata database: `/data/second-brain/metadata`
- Raw files & converted Markdown: `/data/second-brain/documents`

## How to Install

Run the following command via the Tycho CLI:

```bash
tycho install second-brain
```

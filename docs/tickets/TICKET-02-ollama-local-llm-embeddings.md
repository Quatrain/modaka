# Ticket #2: On-Premise / Zero-Cloud Privacy: Local Embeddings & Ollama Inference

- **ID:** TICKET-02
- **Status:** 📋 Backlog / Specified
- **Priority:** High
- **Components:** AI Adapters, Local Inference (`@quatrain/ai-ollama`), QMD Hybrid Search
- **Authors:** Quatrain Engineering Team

---

## 🎯 Objective & Business Value

Provide 100% sovereign, on-premise execution for privacy-sensitive personal or enterprise knowledge bases:
- Zero telemetry or document text transmitted to third-party cloud AI providers.
- Fully local semantic vector embeddings and local LLM chat copilot via Ollama / Llama.cpp.
- Seamless toggle between cloud Gemini and local models in settings.

---

## 🏗️ Technical Architecture & Specifications

### 1. Ollama Adapter (`@quatrain/ai-ollama`)
- Implement `@quatrain/ai` interface targeting local Ollama daemon (`http://localhost:11434` or custom endpoint).
- Recommended default models:
  - Chat & Synthesis: `llama3.2:3b` or `mistral-nemo:12b`.
  - Embeddings: `nomic-embed-text` or `bge-m3`.

### 2. QMD Hybrid Engine Vectorization
- Generate 768-dim embeddings locally on file creation/update.
- Store vectors in local SQLite/DuckDB vector table.
- Execute hybrid BM25 + Cosine similarity ranking in under 20ms without internet connectivity.

---

## 📋 Acceptance Criteria

- [ ] Complete question-answering and search functionality operating without external internet access.
- [ ] Automated health check verifying local Ollama daemon connectivity.

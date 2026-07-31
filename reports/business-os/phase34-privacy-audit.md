# Phase 34 — Privacy Audit

## Objective

Verify that the local AI layer does not leak business data when Local Mode is enabled.

## Design Checks

| Concern | Implementation | Status |
|---------|----------------|--------|
| Prompts sent to local endpoints only | All adapters target `localhost` URLs configured in `ModelConfiguration.discovery` | **Pass** |
| No cloud fallback by default | `ModelConfiguration.privacy.allowCloudFallback` defaults to `false` | **Pass** |
| Embeddings stored locally | `EmbeddingManager` persists vectors to `dataPath/embeddings.json` | **Pass** |
| Business memory never uploaded | `EmbeddingManager.addDocument` calls the local `embed` adapter and stores results on disk | **Pass** |
| Audit data stays local | `AuditLedger` already writes to `dataPath`; no AI layer touches it | **Pass** |
| No prompt logging by default | `ModelConfiguration.privacy.logPrompts` defaults to `false` | **Pass** |
| Optional custom adapters can be restricted | `localAI.adapters` array allows only user-supplied endpoints | **Pass** |

## Code Evidence

- `ModelRouter.extractIntent` calls `this.modelManager.chat()` with the operator's text and the local intent prompt.
- `ModelManager.chat()` resolves a local model from `ModelRegistry` and invokes the provider's `chat()` method.
- `OllamaAdapter`, `LMStudioAdapter`, and `LlamaCppAdapter` construct URLs from `this.baseUrl` only.
- `EmbeddingManager` writes to `this.storePath` (`dataPath/embeddings.json`) and performs cosine similarity in-process.

## Gaps

- **Network-level guarantee**: The adapters call HTTP, not `127.0.0.1` by default. DNS resolution of `localhost` could in theory be overridden; the default should be tightened to `127.0.0.1`.
- **TLS/cert verification**: Local endpoints are plain HTTP. No certificate pinning exists.
- **Prompt content in adapter logs**: Adapters do not log prompts, but `ModelRouter` logs routing metadata (task, model, latency, ok) only, not content.

## Verdict

**Local Mode is privacy-preserving by design for the implemented paths.** The remaining risk is network misconfiguration, which should be locked to `127.0.0.1` and optionally blocked by an OS firewall rule.

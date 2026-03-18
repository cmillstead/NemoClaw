# NemoClaw Security Scan Remediation Plan — 2026-03-17

## Second Pass Results: 0 CRIT, 9 HIGH, 16 MED, 14 LOW (39 total)
## 4 exploit chains identified

Prior scan (PRs #9-#10): 37 findings, all addressed. This is the second pass.

---

## Priority 0 — Fix Immediately (Chains)

### 1. Fix secret redaction gap + DB permissions (CHAIN-001)
**Findings**: SEC-DAT-011, SEC-DAT-003, SEC-DAT-001, SEC-DAT-002, SEC-DAT-004
- [ ] Add missing `export` credential pattern to `session.ts:redactSecrets()` and `compaction.ts:redactSecretsInSummary()`
- [ ] Refactor: extract shared `redactAllSecrets()` function using `SECRET_PATTERNS` from `sanitize.ts`
- [ ] Add `mode: 0o700` to `mkdirSync` in `transcript-db.ts:79`
- [ ] Add `chmodSync(dbPath, 0o600)` after `DatabaseSync` construction in `transcript-db.ts`
- [ ] Add `mode: 0o700` to `mkdirSync` in `config.ts:33`
- [ ] Add `{ mode: 0o600 }` to `writeFileSync` in `config.ts:59`
- [ ] Add `{ encoding: "utf-8", mode: 0o600 }` to `writeFileSync` in `promotion.ts:230`
- [ ] Tests: verify all file/dir permissions; verify `export SECRET=...` is redacted

### 2. Implement secure gateway mode (CHAIN-002)
**Findings**: SEC-ATK-005, SEC-ATK-006
- [ ] Implement `NEMOCLAW_SECURE_MODE` env var check in `nemoclaw-start.sh`
- [ ] When secure mode: `allowInsecureAuth: False`, `dangerouslyDisableDeviceAuth: False`
- [ ] Restrict auto-pair to known client IDs (e.g., `openclaw-control-ui`)
- [ ] Reduce auto-pair window from 600s to 60s
- [ ] Consider making secure mode the default (insecure opt-in via `NEMOCLAW_INSECURE_MODE=1`)

### 3. Fix environment variable leakage (CHAIN-003 partial)
**Findings**: SEC-DAT-005, SEC-DAT-006, SEC-DAT-010
- [ ] `goose.ts:167`: Build minimal env — only `PATH`, `HOME`, `TERM`, `SHELL` + `buildGooseEnv()` vars
- [ ] `telegram-bridge.js:110`: Build minimal env — only `PATH`, `HOME` + `NVIDIA_API_KEY`
- [ ] Tests: verify child env does NOT contain `TELEGRAM_BOT_TOKEN`, `GITHUB_TOKEN`, `ALLOWED_CHAT_IDS`

---

## Priority 1 — Fix This Sprint

### 4. SSRF hardening (CHAIN-004 partial)
**Findings**: SEC-ATK-001, SEC-ATK-002
- [ ] Add `redirect: "manual"` to both `fetch()` calls in `validate.ts`
- [ ] If redirect received, re-validate target URL against SSRF blocklist
- [ ] Consider DNS resolution at validation time (resolve hostname, check IP against private ranges)

### 5. Telegram error exposure
**Findings**: SEC-DAT-008, SEC-DAT-009
- [ ] `telegram-bridge.js:143`: Send generic error to user, log full stderr server-side
- [ ] `telegram-bridge.js:212`: Send generic error, log `err.message` + stack server-side
- [ ] `telegram-bridge.js:177,208`: Log only metadata (chat ID, message length), not content

### 6. Memory prompt injection defense
**Findings**: SEC-ATK-009
- [ ] XML-escape `result.path` and `fact` content in `recall.ts:107-108`
- [ ] Escape `<`, `>`, `&`, `"`, `'` at minimum

### 7. CI and supply chain fixes
**Findings**: SEC-DEP-001, SEC-DEP-006, SEC-DEP-007
- [ ] Remove `|| true` from `npm audit` in `ci.yml`
- [ ] Add SHA-256 verification for Ollama installer (match nvm pattern from `install.sh:93-111`)
- [ ] Add SHA-256 verification for NodeSource installer or switch to official binary distribution
- [ ] Pin Docker base image by digest in `Dockerfile:5`

---

## Priority 2 — Backlog

### 8. Additional supply chain hardening
**Findings**: SEC-DEP-017, SEC-DEP-018, SEC-DEP-019, SEC-DEP-020
- [ ] Add checksum verification for OpenShell and Goose binary downloads
- [ ] Add checksum verification for Cloudflared binary download
- [ ] Fix `walkthrough.sh:88` — use `tmux set-environment` instead of cmdline interpolation
- [ ] Pin vllm version in `brev-setup.sh:125`, use virtual environment

### 9. Remaining MED findings
**Findings**: SEC-ATK-007, SEC-ATK-008, SEC-DAT-013
- [ ] Validate `CHAT_UI_URL` against allowlist of schemes, restrict to localhost by default
- [ ] Add `.env` and `.env.*` to `.gitignore`
- [ ] Strip credentials from `inference_cfg` before writing `plan.json`, set file mode 0o600

### 10. LOW findings and defense-in-depth
- [ ] Switch remaining `run()` calls to `runArgv()` where feasible (SEC-ATK-003, SEC-ATK-012)
- [ ] Use `execFileSync` in `isRepoPrivate()` (SEC-ATK-004)
- [ ] Change E2E test SSH to `StrictHostKeyChecking=accept-new` (SEC-ATK-011)
- [ ] Restrict sandbox policy methods to needed HTTP verbs (SEC-ATK-013)
- [ ] Reduce `validateKeyPrefix()` exposure to 3 chars (SEC-DAT-012)
- [ ] Pin Python docs deps in `pyproject.toml` (SEC-DEP-012)
- [ ] Verify `sphinx-llm` package provenance (SEC-DEP-013)

---

## Test Requirements

Each fix must include a test that:
1. Attempts the attack scenario described in the finding
2. Verifies the input is rejected or sanitized
3. Verifies no secrets/internals are leaked

Priority: P0 items (Phases 1-3) should be completed first as a single PR.

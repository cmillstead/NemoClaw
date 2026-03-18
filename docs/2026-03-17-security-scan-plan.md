# NemoClaw Security Scan Remediation Plan — 2026-03-17

## Scan Results: 3 CRIT, 10 HIGH, 14 MED, 10 LOW (37 total)

---

## Phase 1: Shell Injection Elimination (CRIT — 6 findings)

### 1.1 Add runArgv to bin/lib/runner.js
- New function using execFileSync with argv array (no shell)
- Keep run()/runCapture() but mark deprecated

### 1.2 Migrate bin/nemoclaw.js shell calls
- setupSpark L47: Use spawnSync with env inheritance (sudo -E already passes env)
- deploy L86-132: Validate instance name with RFC 1123 regex. Replace all ssh/scp/brev calls with runArgv
- **SEC-ATK-001, SEC-ATK-005** resolved

### 1.3 Migrate bin/lib/onboard.js shell calls
- setupInference L373-408: Use execFileSync for openshell calls
- createSandbox L211: Same pattern
- **SEC-ATK-002** resolved

### 1.4 Migrate bin/lib/nim.js shell calls
- All docker commands: use runArgv with argv arrays
- **SEC-ATK-007** resolved

### 1.5 Fix status.ts and logs.ts in plugin layer
- Replace promisified exec with execFile
- **SEC-DEP-010, SEC-DEP-011** resolved

---

## Phase 2: Telegram Bridge Hardening (HIGH — 3 findings)

### 2.1 Require ALLOWED_CHAT_IDS
- Exit with error if unset or empty
- Log rejected messages with chat ID
- **SEC-ATK-004** resolved

### 2.2 Eliminate shell interpolation for messages
- Encode message as base64 before SSH
- Or write to temp file, SCP, reference by path
- **SEC-ATK-003** resolved

### 2.3 Remove API key from SSH command string
- Use SSH SendEnv + remote AcceptEnv, or SCP a temp env file
- **SEC-DAT-003** resolved

---

## Phase 3: Credential Exposure (HIGH — 7 findings)

### 3.1 Never pass credentials as CLI arguments
- All --credential "KEY=value" patterns: write to temp file (mode 0600) and pass via --credential-file, or use env inheritance
- Affects: onboard.js, setup.sh, runner.py
- **SEC-DAT-001, SEC-DAT-002, SEC-DAT-005, SEC-DAT-006, SEC-DAT-014, SEC-DAT-018** resolved

### 3.2 Fix deploy credential flow
- Pipe credentials via SSH stdin instead of temp file + SCP
- Add SSH command to delete .env after services start
- Use StrictHostKeyChecking=accept-new instead of no
- **SEC-DAT-004, SEC-ATK-006** resolved

### 3.3 Sanitize Goose error output
- Run error messages through scanForSecrets before returning
- **SEC-DAT-016** resolved

---

## Phase 4: Memory System Hardening (MED — 5 findings)

### 4.1 Set restrictive file permissions
- para.ts ensureMemoryDirs: mkdirSync with mode 0o700
- para.ts writeFact: writeFileSync with mode 0o600
- **SEC-DAT-012, SEC-DAT-017** resolved

### 4.2 Add secret scanning to transcript storage
- In session.ts append: run scanForSecrets on content, redact before SQLite insert
- **SEC-DAT-020** resolved

### 4.3 Add secret scanning to compaction
- In compaction.ts compact: run scanForSecrets on summary, redact before storage
- **SEC-DAT-011** resolved

---

## Phase 5: Docker and CI Hardening (MED/HIGH — 4 findings)

### 5.1 Fix .dockerignore
- Add: .env, .env.*, *.env, credentials.json, .nemoclaw/
- **SEC-DEP-024** resolved

### 5.2 Pin Docker base image
- Change FROM node:22-slim to FROM node:22-slim@sha256:DIGEST
- Pin pyyaml version in Dockerfile and CI
- **SEC-DEP-020** resolved

### 5.3 Pin CI actions to SHA
- Replace @v4/@v5 tags with full SHA digests
- Add npm audit --audit-level=high step
- **SEC-DEP-025** resolved

### 5.4 Document insecure auth flags
- Add warning to nemoclaw-start.sh for allowInsecureAuth/dangerouslyDisableDeviceAuth
- Consider NEMOCLAW_SECURE_MODE env var
- **SEC-DEP-023** resolved

---

## Phase 6: Remaining Medium/Low (8 findings)

- SEC-ATK-008: Validate endpoint URLs (scheme, reject private IPs) in validate.ts
- SEC-ATK-011: Use crypto.randomBytes for temp filenames, wrap in try/finally
- SEC-ATK-012: Validate preset names match ^[a-z0-9-]+$ in policies.js
- SEC-DAT-008: Truncate logged Telegram messages to 50 chars
- SEC-DAT-009: Add .gitignore entry for credentials.json, document keychain migration
- SEC-DAT-010: Document SQLite encryption path (sqlcipher), set DB dir to 0700
- SEC-DEP-019: Allowlist env vars for child processes instead of spreading process.env
- SEC-DEP-012: Replace execSync with shell in onboard.ts with execFileSync

---

## Test Requirements

Each fix must include a test that:
1. Attempts the attack scenario described in the finding
2. Verifies the input is rejected or sanitized
3. Verifies no shell metacharacters are interpreted

Priority: Phases 1-3 (CRIT+HIGH) should be completed first as a single PR.

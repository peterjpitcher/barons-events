# Security & Data Risk Report: Graphify Session-Setup Overhaul

**Date:** 2026-04-16
**Spec:** `docs/superpowers/specs/2026-04-16-graphify-session-setup-overhaul-design.md`
**Severity scale:** CRITICAL / HIGH / MEDIUM / LOW

---

## CRITICAL Findings

### C1: Env Var Scanner Will Capture Live Secrets If Pointed at Wrong Files

**Section:** 6.3 Env Var Scanner

The spec says: "Read `.env.example` (canonical list)" and "Grep for `process.env.` across codebase". This is safe in isolation. However, the scanner's purpose is to cross-reference declared vs used vars. If the implementation accidentally reads `.env.local` or `.env*.local` instead of `.env.example`, it captures live secrets (Supabase service role key, Twilio auth token, OpenAI API key, Turnstile secret, cron secret).

**Exploit scenario:** A bug in the scanner reads `.env.local`, writes env var values into `docs/architecture/environment.md`, which IS committed to git (Section 10.4 confirms `docs/architecture/*.md` is committed). Secrets land in version control.

**Mitigation required:**
- Scanner MUST have an explicit allowlist: only `.env.example` -- never `.env`, `.env.local`, `.env*.local`
- Scanner must NEVER read file contents of env files beyond `.env.example`
- Add a pre-commit hook that blocks commits containing known secret patterns in `docs/architecture/`

---

### C2: Generated Docs Committed to Git Expose Full Internal Architecture

**Section:** 9.1, 9.3, 10.4

The spec explicitly states `docs/architecture/*.md` is committed. These files contain:
- Complete database schema with table names, column names, foreign keys, RLS policy details
- All server action names with the tables they mutate and permission models
- Full route map with auth requirements (which routes lack auth is visible)
- Middleware chain and auth flow details
- Integration touchpoints (which services, which files)
- Cross-reference map linking everything to everything

**Exploit scenario:** An attacker with read access to the repo (public repo, leaked invite, compromised CI) gets a complete attack surface map. They know exactly which routes lack auth, which tables have which RLS policies, which server actions skip audit logging, and the full auth middleware chain. This is a penetration tester's dream document.

**Severity:** CRITICAL if the repo is public or ever becomes public. HIGH for private repos (defense in depth).

**Mitigation required:**
- If repo is private and will remain so: document this as an accepted risk
- Consider gitignoring `docs/architecture/data-model.md`, `auth-and-permissions.md`, and `relationships.md` -- these are the most dangerous
- At minimum: strip RLS policy details from generated docs; those should only be queryable via MCP

---

## HIGH Findings

### H1: MCP Server Exposes Full Graph Including Database Schema to Any Connected Agent

**Section:** 10.1

The MCP server exposes `query_graph`, `get_node`, `get_neighbors`, `shortest_path` with no authentication or scoping. Any agent connected to the MCP server can query the complete graph including:
- Database table structures and RLS policies
- Auth flow details
- All server action internals

**Exploit scenario:** A malicious or compromised MCP client (another tool in the agent's toolchain) queries the graph for sensitive data. Since MCP servers share the agent's trust boundary, any tool with MCP access can read everything.

**Mitigation required:**
- The MCP server is local-only (good), but the spec should explicitly state no network binding
- Consider adding query filtering: exclude `database_column` nodes containing sensitive patterns from graph results
- Document that the MCP server inherits the security posture of the local machine

### H2: Git Hooks Execute Arbitrary Python as Current User

**Section:** 10.2

`graphify install` installs git hooks (`post-commit`, `post-checkout`, `post-merge`) that run `graphify` (Python). These hooks:
- Execute on every commit, branch switch, and merge
- Run as the current user with full filesystem access
- Are installed by a third-party tool (`graphify`)

**Exploit scenario (supply chain):** If the `graphifyy` PyPI package (note: spec shows `pip install graphifyy` with double-y in Section 11.3) is typosquatted or compromised, the hooks execute malicious code on every git operation. The double-y in the package name already looks suspicious and increases typosquat risk.

**Mitigation required:**
- Pin the Graphify version in requirements/install docs
- Verify the correct PyPI package name (single vs double y)
- Audit the hook scripts after `graphify install` before first use
- Consider running hooks in a restricted environment

### H3: Changes Manifest Logs All File Paths Including Sensitive Locations

**Section:** 7.1, 7.2

The manifest logs every file edit with full paths. Category detection includes `.env*` files (Section 7.2). The manifest is gitignored (good), but:

**Exploit scenario:** If the manifest is accidentally committed or read by a tool that exfiltrates data, it reveals which env files were touched, migration file names (which hint at schema changes), and the full file tree structure.

**Mitigation:** Already gitignored. Ensure the manifest never contains file contents, only paths. Add a `.gitignore` rule specifically for `.claude/changes-manifest.log` (confirmed present in spec Section 10.4, but not in current `.gitignore` -- the current `.gitignore` has no graphify or changes-manifest entries).

---

## MEDIUM Findings

### M1: Python Dependency in a Node.js Project -- Expanded Attack Surface

Graphify requires Python + pip in a project that otherwise only needs Node.js. This:
- Expands the supply chain (PyPI + npm)
- Requires Python on every developer machine
- Introduces a second language runtime with its own vulnerabilities

**Mitigation:** Document as a developer tooling dependency only, never bundle in production. Ensure `graphify-out/` is in `.dockerignore` if containerised.

### M2: Database Ingestion Agent Queries Live Schema

**Section:** 5

The database ingestion agent runs `information_schema.columns`, `pg_constraint`, `pg_policies`, `pg_enum` against the live database. Results are stored in `graph.json` (gitignored, good) but also flow into `docs/architecture/data-model.md` (committed).

**Risk:** Schema details including RLS policy names and definitions end up in committed docs. See C2.

### M3: Section Hashes File Could Enable Targeted Attacks

**Section:** 9.5

`.section-hashes.json` is in `docs/architecture/` which is committed. While hashes of content are not directly exploitable, changes in hashes between commits reveal exactly which architectural sections changed, giving attackers a changelog of structural modifications.

**Mitigation:** Low risk. Accept or gitignore.

---

## LOW Findings

### L1: PreToolUse Hook is Non-Blocking

**Section:** 8.2

The generated doc guard "injects advisory warning" but is "non-blocking -- agent can override." This means generated docs can be manually edited, creating drift between graph truth and committed docs. Not a security risk per se, but a data integrity concern.

### L2: Stale Graph Could Produce Incorrect Security Documentation

If `graph.json` is stale (commit hash mismatch), the generated docs may not reflect current auth requirements, RLS policies, or route protections. An agent relying on stale data could make incorrect security assumptions.

---

## Summary of Required Actions

| Priority | Action | Blocks Ship? |
|----------|--------|-------------|
| CRITICAL | Env scanner: hardcode `.env.example` only, never read live env files | Yes |
| CRITICAL | Decide committed docs risk: strip sensitive data or gitignore sensitive files | Yes |
| HIGH | Verify correct PyPI package name, pin version, audit installed hooks | Yes |
| HIGH | Add `.claude/changes-manifest.log` and `graphify-out/` to project `.gitignore` now | Yes |
| HIGH | Document MCP server is local-only, no network binding | No |
| MEDIUM | Document Python as dev-only dependency, add to `.dockerignore` | No |
| MEDIUM | Consider stripping RLS policy details from committed docs | No |
| LOW | Accept non-blocking hook risk, document in spec | No |

---

## Current .gitignore Gap

The project's current `.gitignore` does NOT contain entries for:
- `graphify-out/`
- `.claude/changes-manifest.log`
- `docs/architecture/.section-hashes.json`

The spec says these should be gitignored (Section 10.4) but implementation must add them before any Graphify work begins. Without this, the first `git add .` after graph generation commits the full knowledge graph to version control.

# IA DEV — Project Context

## Branch & State
- **Current branch:** `fix/ia-dev-git-source-of-truth` (HEAD `817ed51`, just after commit `e6dc40b`)
- **Working tree:** clean
- **Open PR:** #2 on `yuga-hashimoto/opencode-chatgpt-bridge`, mergeable, head SHA `e6dc40b` = fork tip (pushed)

## Architecture: Git Physical as Source of Truth
- The physical filesystem + Git is the only authoritative source of truth.
- `opencode` is an editing agent; bridge tools (`repo_git_status`, `repo_git_diff`) read the physical repo directly.
- `opencode_vcs_status` and `opencode_get_diff` return opencode's internal view, which may not match the physical filesystem.
- A writing task is only complete when `git status` and `git diff` show physical changes.
- Verification flow: ChatGPT → IA DEV Bridge → opencode → filesystem real → Git real → tests → diff verificable → human review.

## `opencode_get_messages` — Limit Semantics (verified against live opencode 1.18.35)
- `?limit=N` returns the **last N messages (tail)** in chronological order.
- `resolveSessionStatus` (src/opencode/status.ts:12) depends on this: `getMessages(sessionId,1)` + `.at(-1)` → latest message.
- **Default change:** omitting `limit` now returns the last 50 messages instead of the full transcript (unbounded payload). Aligned with `run_task`'s `messageLimit` default of 50.
- Description updated: "`limit` uses tail semantics (most recent N). Defaults to the last 50 messages when omitted."

## `checkOpencodeCli` — Portability fix
- Removed the `which` spawn and `path` field from `OpencodeCliStatus`. The binary is detected solely via `opencode --version`; any valid executable (e.g., `process.execPath`) correctly reports `installed: true`.
- Setup guide line now reads `opencode: installed (v1.17.7)` without a path suffix.
- Portable test added: `tests/opencode-setup.test.ts` verifies with `process.execPath`.

## CI — exact block on PR #2
- `.github/workflows/ci.yml` exists **only** on the fix branch (commit `9a5edee`); `origin/main` (`34f69c3`) and the fork's default branch have no workflows.
- PR #2 is a **cross-repo** PR: base = upstream `yuga-hashimoto/opencode-chatgpt-bridge`, head = fork `davidsegade/opencode-chatgpt-bridge:fix/ia-dev-git-source-of-truth`.
- For fork PRs, `pull_request` workflows execute in the **base** repo; the base repo has no CI workflow on main, and its Actions policies are not readable (403 / EOF on run listings).
- `check-runs` on the PR head commit: **total 0** — no check ever ran.
- **Nothing local can produce checks on PR #2** without human action on the upstream repo (e.g., requesting CI activation or opening a PR against the fork's own main). Documented in MIGRATION.md.

## Graphify / ECC
- **Zero references** anywhere in IA-DEV (src, tests, .github, README, MIGRATION.md, git history across all branches).
- Appear only in `ia-dev-architecture-lab/ia-dev-afternoon-report.md:79,85` as "Phase B/C — Graphify, Context Ranker, ECC selective, measurements" and "Phase B implementation (Graphify, Context Ranker, ECC selective)" — a roadmap of the architecture lab, with draft PRs #86/#87/#89 awaiting human review.
- **Verdict:** a pending phase of the broader IA DEV 2.x architecture, tracked in `ia-dev-architecture-lab` — **not part of this repo's current architecture**, not implemented, not on any branch here. The only vestige in this repo is the `.ia-dev.yml.example` comment "Context budget for Author + Ranker", now corrected to "Context budget for Author model".

## Stale comment fixed
- `.ia-dev.yml.example:74`: `"Context budget for Author + Ranker"` → `"Context budget for Author model"` (the Ranker component does not exist in this codebase).
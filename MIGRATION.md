# IA DEV Bridge — Architecture & Migration Guide

## Project Location

**Current project:** `/Users/davidsegade/IA/IA-DEV` (this repository)

This is the durable, version-controlled location. The previous `/private/tmp/opencode-chatgpt-bridge` was ephemeral and should not be used.

---

## Architecture: Git Physical as Source of Truth

### Core Principle

**The physical filesystem + Git is the only authoritative source of truth.**

- `opencode` is an **editing agent** — it proposes and applies changes
- The bridge's `repo_git_status` and `repo_git_diff` tools read the **physical Git repository** directly
- `opencode_vcs_status` and `opencode_get_diff` return opencode's **internal view** which may not match the physical filesystem
- A writing task is **only complete** when `git status` and `git diff` show physical changes

### Verification Flow

```
ChatGPT → IA DEV Bridge → opencode → filesystem real → Git real → tests → diff verificable → revisión humana
```

The `ia_dev_run_task` tool implements this flow:
1. Validates repo exists and is a real Git repo
2. Verifies Git top-level matches requested path
3. Captures initial HEAD and status
4. Requires clean repo (by default)
5. Blocks writing to main/master (by default)
6. Creates NEW opencode session on current server
7. Sends prompt, waits for terminal state using correct status detection
8. Re-queries physical Git for final status and diff
9. Returns success **only if** Git shows actual changes

---

## Session-Server Binding (Critical)

### The Problem

Multiple opencode servers can run on different ports. Sessions created on one server **cannot** be queried from another.

### The Solution

Every bridge session stores its `baseUrl` (the opencode server it was created on). Before any session-specific operation, the bridge verifies:

```
persistedSession.baseUrl === currentManagedServer.baseUrl
```

If they differ → **`SERVER_MISMATCH` error** (also surfaced as `STALE_SESSION`)

**Operations that enforce this:**
- `opencode_get_session_status`
- `opencode_send_message`
- `opencode_get_messages`
- `opencode_get_diff`
- `opencode_abort`
- `opencode_respond_permission`
- `opencode_wait_for_session`
- Any operation using `opencodeSessionId`

**Operations that do NOT enforce (repo-level):**
- `opencode_read_file`
- `opencode_find_files`
- `opencode_vcs_status`
- `opencode_capabilities`
- `list_projects`
- `opencode_start`
- `repo_git_status`
- `repo_git_diff`

### Practical Implications

- **Restarting the bridge** or **changing opencode server port** invalidates all previous bridge sessions
- You **must create a new session** after any server change
- Old sessions in `~/.opencode-chatgpt-bridge/sessions.json` become stale and will return `SERVER_MISMATCH`

---

## OpenCode Status Detection

The bridge handles both current and legacy status formats:

```typescript
// Current format
{ type: "idle" }
{ type: "busy" }
{ type: "running" }
{ type: "completed" }
{ type: "error" }
{ type: "cancelled" }

// Legacy format
{ status: "idle" | "completed" | "error" | "cancelled" | "running" | "busy" }
```

**Terminal states:** `idle`, `completed`, `error`, `cancelled`
**Non-terminal states:** `busy`, `running`

Helpers in `src/types.ts`:
- `isTerminalOpencodeStatus(status)` — returns true for terminal states
- `isBusyOpencodeStatus(status)` — returns true for busy/running states

---

## MCP Tools Summary

### Bridge & Project Tools
| Tool | Purpose |
|------|---------|
| `bridge_health` | Check bridge config and managed opencode processes |
| `list_projects` | List Git repos under allowed roots |

### Session Tools (enforce server binding)
| Tool | Purpose |
|------|---------|
| `opencode_start` | Start/reuse opencode server for a repo |
| `opencode_stop` | Stop managed opencode servers |
| `opencode_create_session` | Create new opencode session → returns `bridgeSessionId` |
| `opencode_list_sessions` | List bridge sessions |
| `opencode_get_session_status` | Get session status (enforces server binding) |
| `opencode_send_message` | Send prompt to session (enforces server binding) |
| `opencode_get_messages` | Fetch session messages (enforces server binding) |
| `opencode_get_diff` | Fetch session diff (enforces server binding) |
| `opencode_abort` | Abort running session (enforces server binding) |
| `opencode_respond_permission` | Respond to permission prompt (enforces server binding) |
| `opencode_wait_for_session` | Poll until terminal state (enforces server binding) |
| `opencode_launch_task` | Create session + send prompt + wait + return diff |

### Repo-Level Tools (no server binding)
| Tool | Purpose |
|------|---------|
| `opencode_read_file` | Read file via opencode |
| `opencode_find_files` | Fuzzy find files via opencode |
| `opencode_vcs_status` | Get opencode's VCS status (informational only) |
| `opencode_capabilities` | List agents, commands, providers |

### Git Physical Tools (AUTHORITATIVE)
| Tool | Purpose |
|------|---------|
| `repo_git_status` | **Authoritative** Git status from physical filesystem |
| `repo_git_diff` | **Authoritative** Git diff from physical filesystem |

### End-to-End Task Tool
| Tool | Purpose |
|------|---------|
| `ia_dev_run_task` | Full task execution with Git verification — **returns success only if Git shows changes** |

---

## Git Physical Layer (`src/git/repository.ts`)

All functions use `execFile` (no shell, no unsafe interpolation):

| Function | Purpose |
|----------|---------|
| `validateGitRepo(repoPath)` | Verify path exists, is Git repo, top-level matches |
| `getGitStatus(repoPath)` | Full status: branch, HEAD, clean, porcelain, untracked, modified, staged |
| `getCurrentBranch(repoPath)` | Current branch name |
| `getHead(repoPath)` | Current HEAD commit hash |
| `getWorktreeTopLevel(repoPath)` | Git top-level directory |
| `getGitDiff(repoPath)` | Unstaged diff |
| `getGitDiffIncludingUntracked(repoPath)` | Unstaged + staged + untracked as separate sections |
| `assertClean(repoPath)` | Throw if uncommitted changes exist |
| `assertNotMain(repoPath)` | Throw if on main/master branch |

---

## Security Model (Unchanged)

- `opencode` bound to `127.0.0.1` only
- Repositories must be under `OPENCODE_BRIDGE_ALLOWED_ROOTS`
- Bridge bearer token (`OPENCODE_BRIDGE_TOKEN`) for exposed/tunneled use
- URL-token fallback for connector UIs without header support
- No arbitrary shell execution exposed
- Diffs are first-class for review before commit

---

## Migration from `/private/tmp`

If you have an existing instance in `/private/tmp`:

```bash
# 1. Stop old bridge
pnpm -C /private/tmp/opencode-chatgpt-bridge run uninstall-service

# 2. Copy config
cp /private/tmp/opencode-chatgpt-bridge/.env /Users/davidsegade/IA/IA-DEV/.env

# 3. Sessions persist automatically in ~/.opencode-chatgpt-bridge/sessions.json
#    (but will be STALE after server restart — create new sessions)

# 4. Build & start in new location
cd /Users/davidsegade/IA/IA-DEV
pnpm install
pnpm run build
pnpm run install-service
pnpm run service-status
```

---

## Verification Checklist

After any changes, run:

```bash
pnpm run typecheck  # TypeScript strict mode
pnpm test           # Unit tests
pnpm run build      # Production build
```

All three must pass.

---

## Development Workflow

```bash
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
pnpm run validate  # runs all three
```

---

## Key Files

| File | Purpose |
|------|---------|
| `src/git/repository.ts` | Physical Git operations (source of truth) |
| `src/types.ts` | Type definitions, status helpers |
| `src/mcp/tools.ts` | MCP tool registrations |
| `src/mcp/results.ts` | Tool result helpers |
| `src/security/paths.ts` | Path validation, allowed roots |
| `src/opencode/process.ts` | opencode process management |
| `src/state/store.ts` | Bridge session persistence |
| `tests/mcp-tools.test.ts` | Tool behavior tests |

---

## License

MIT
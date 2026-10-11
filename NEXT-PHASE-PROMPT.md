# Next Phase Prompt

## Current phase closed (fix/ia-dev-git-source-of-truth)
- 313/313 tests pass (`pnpm test`)
- `pnpm run typecheck` and `pnpm run build` clean
- `git diff --check` no whitespace errors
- Changes committed and pushed to fork (PR #2 updated)

## Technical debts resolved this phase
1. `opencode_get_messages` default bounded to last 50 messages (tail semantics documented)
2. `checkOpencodeCli` `which` spawn removed; portable `--version`-only detection
3. Stale "Author + Ranker" comment in `.ia-dev.yml.example` corrected
4. CI blockage on PR #2 documented (upstream base repo has no workflow; no admin access)

## Open questions for next phase
- **Graphify / ECC**: the architecture lab (ia-dev-architecture-lab) lists Graphify, Context Ranker, and ECC as Phase B items (draft PRs #86/#87/#89 pending human review). Decision needed: integrate any of these into this bridge, or keep as external roadmap.
- **CI for PR #2**: the upstream repo `yuga-hashimoto/opencode-chatgpt-bridge` has no CI workflow on main and no readable Actions policies. Either request CI activation there, or open a PR against the fork's own `main` branch.
- **AGENTS.md / PROJECT-CONTEXT.md**: these docs are now created; future phases may refine them.

## Next steps (human-decision required)
1. Decide on Graphify/ECC — keep as external roadmap, or plan integration into this bridge.
2. If CI for PR #2 is needed, coordinate with upstream repo maintainers (or open a PR against the fork's main).
3. Run `pnpm validate` to confirm full suite passes after any new changes.
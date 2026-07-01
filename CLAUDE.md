# CLAUDE.md

**Load the `deepspace` skill before working in this repo.** It is the source
of truth for the SDK — invoke it via the Skill tool first, then read project
source for repo-specific details.

The skill is installed by the scaffold at `.agents/skills/deepspace/SKILL.md`
(for Claude Code agents, a `.claude/skills/deepspace` symlink is also
created so Claude Code picks it up).
Restart your agent session so it picks up the new skill — or, to keep
working without a restart, Read `.agents/skills/deepspace/SKILL.md` directly
(loading `references/*` on demand).

If the file doesn't exist, scaffold-time install failed (typically a network
issue). Install (or reinstall) it manually:

```sh
npx deepspace skills add -y                  # install into this project
npx deepspace skills add -g -y               # install globally for every project
npx deepspace skills add --agent codex -y    # specific agent
```

If you can't install it at all, read SKILL.md directly:
<https://github.com/deepdotspace/deepspace-skill/blob/main/skills/deepspace/SKILL.md>

## About this project

This is a **DeepSpace** app — a real-time collaborative app built on the
[`deepspace`](https://www.npmjs.com/package/deepspace) SDK and deployed to
Cloudflare Workers via `npx deepspace deploy`.

## Project commands

```sh
npx deepspace login        # authenticate with app.space
npx deepspace dev          # local dev server (vite + miniflare)
npx deepspace deploy       # deploy to <app>.app.space
npx deepspace add --list   # list optional features (messaging, etc.)
npx deepspace add <feature>
```

## Loop stop rules

The build–check loop (`/loop`) keeps cycling the `builder` and `checker`
subagents until ONE of these is true. These rules are binding — follow them
exactly:

- **All green.** Every check passes. Stop and report success, including the
  checker's proof from the final cycle.
- **5 cycles used.** Stop. Report what still fails and what was tried each
  cycle. Do not start a 6th cycle.
- **Same failure twice in a row.** If a cycle ends with the same failure the
  previous cycle ended with, stop — the builder is guessing, not fixing.
  Escalate to the human.
- **A fix breaks a previously passing check.** Stop. Something is being damaged
  to patch something else; a human needs to decide.

Never report success without the checker's output from the final cycle.
Never weaken, skip, or delete a test, type, or lint rule to reach all green —
fix the code, not the check.

The checker runs the fast local checks: `npm run test:unit`,
`npm run type-check`, and `npm run lint`. It must not run `npm test` /
`deepspace test` (those need a live server and auth). `test:unit` uses the
dedicated `vitest.config.ts` (plain Node, no app plugins), so it stays fast
and server-free.


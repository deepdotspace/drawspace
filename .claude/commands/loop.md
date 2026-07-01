---
description: Run the builder and checker in a loop until all checks pass or a stop rule fires, then write a run report
argument-hint: <task to build or fix>
allowed-tools: Read, Grep, Glob, Bash, Write, Task
model: opus
---

Run this task as a build–check loop: $ARGUMENTS

You are the orchestrator. You coordinate; you do NOT write source code or run
the checks yourself — the subagents do that. The ONLY file you write yourself is
the run report described at the bottom (you may use Write for that report only).

1. Write a one-line brief: the goal, the files in scope, and the definition of done.
2. Dispatch the `builder` subagent (via the Task tool) to implement the task.
3. Dispatch the `checker` subagent to run all checks.
4. Read the checker's report:
   - If it says `ALL GREEN`: stop the loop and go to "Run report" below.
   - If it says `FAILED`: send the exact failures to the `builder` to fix, then go back to step 3.
5. Print the cycle count out loud every iteration: `Cycle N of 5`.

Repeat up to 5 cycles maximum.

As you go, keep a running journal in memory for every cycle:
- the cycle number,
- exactly which checks the checker planned to run and which it actually ran (and which it skipped, and why),
- what failed, copied verbatim from the checker (file:line - error - which check),
- why a new cycle was started (which failures were handed back to the builder),
- what the builder changed in response (its one-line report).

The stop rules in CLAUDE.md are binding. Stop at 5 cycles; stop if the same
failure repeats twice in a row; stop if a fix breaks a previously passing
check; never claim success without the checker's output from the final cycle;
never weaken or delete a check to reach green.

## Run report (ALWAYS write this — success, cap, or early stop)

No matter how the loop ends, write a markdown report before you finish. This is
mandatory; a run is not complete until the report exists.

- Pick the path `docs/loop-runs/<UTC-date>-<short-task-slug>.md`. Get the
  timestamp with Bash (`date -u +%Y%m%d-%H%M%S`); make the slug a few kebab-case
  words from the task. Create the `docs/loop-runs/` directory if it doesn't exist.
- Write the file with this structure:
  - **Task** — the original `$ARGUMENTS` and your one-line brief / definition of done.
  - **Outcome** — one of: `ALL GREEN`, `STOPPED: 5-cycle cap`, `STOPPED: same failure twice`, `STOPPED: a fix broke a passing check`. Include how many cycles were used.
  - **Checks** — what the checker was configured to run (the planned commands), and what it actually ran vs skipped each cycle, with the reason for any skip.
  - **Cycle log** — one section per cycle: what the builder did, what the checker reported verbatim, what failed and why, and (if not the last cycle) why a new cycle was started.
  - **How it passed** (only if ALL GREEN) — a short narrative of which fixes moved it from red to green, plus the checker's final proof output pasted in full.
  - **Still failing / next steps** (only if it stopped without green) — what is still red, what was tried each cycle, and a recommendation for the human.
- After writing it, tell me the report path and paste the Outcome + final checker proof inline so I can see it without opening the file.

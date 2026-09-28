# Benchmark: time-to-context with and without DevPilot

This benchmark checks the claim that DevPilot cuts context-gathering time. **Quote only what you measure here.** If
the median differs from any number on a résumé or landing page, update that number to match.

## Tasks

[`tasks.json`](tasks.json) has 10 tasks on the demo project ([`../demo`](../demo)), whose issues are filed on this
repo as [#1–#5](https://github.com/Ashbruh22/Devpilot_MCP/issues?q=label%3Ademo). Most take the form "find the root cause of issue #N and the file to
change". Each task has a ground-truth answer (files and root cause) for scoring correctness.

## Conditions

| Condition  | Setup                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manual`   | Claude Code **without** DevPilot. The agent reads the issue (`gh issue view` or the pasted URL), greps, reads files, and runs `npm test` itself.        |
| `devpilot` | Claude Code **with** DevPilot connected. Start with `/mcp__devpilot__triage_issue Ashbruh22 Devpilot_MCP <N>` (or the task prompt for non-issue tasks). |

Keep everything else fixed: the same model, the same machine, a fresh clone of the demo repo at the same commit, a
fresh session per run, and the same task prompt.

## What to record

- **time_to_context_s:** seconds from sending the prompt to the moment the agent first names the correct file **and**
  root cause. Stop the clock there, not at the end of the fix. Read the timestamps from the session transcript.
- **tool_calls:** the number of tool calls (or shell commands, for the manual condition) up to that point.
- **correct:** `yes` if the named file(s) and root cause match `tasks.json`, otherwise `no`. Incorrect runs count
  toward the per-condition medians but are excluded from paired savings.

Run each task at least once per condition, and ideally 3×, alternating which condition goes first. Append one row per
run to [`results.csv`](results.csv):

```csv
task_id,condition,agent,model,time_to_context_s,tool_calls,correct,date,notes
T01,manual,claude-code,<model>,<seconds>,<calls>,yes,<date>,
T01,devpilot,claude-code,<model>,<seconds>,<calls>,yes,<date>,
```

## Summarize

```bash
npm run bench:summary
```

This prints the median time and tool calls per condition, and the **median per-task time saved** (paired tasks only,
correct in both conditions) with its range. The summary logic is unit-tested in `test/bench.test.ts`.

## Results

_No runs recorded yet._ Once `results.csv` has data, paste the summary here with the date, model, and number of
runs.

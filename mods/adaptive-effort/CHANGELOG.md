# Changelog

All notable changes to adaptive-effort. Versions follow [Semantic Versioning](https://semver.org): a new major version
changes behaviour you rely on, a minor version adds features, a patch fixes bugs.

## 1.3.1 (2026-10-16)

Leaner: the mod keeps to effort.

- The subagent note is gone: the mod no longer comments on subagent calls or suggests other models or workers.
- The rules line beside the prompt names no helpers.
- The status explains the budget step plainly: over budget the higher levels need more reason; an answer Claude gave
  is never cut down.

## 1.3.0 (2026-10-16)

An experimental option: break to simple.

- **Settings** has a new checkbox, unchecked by default: **Break to simple (experimental)**. Checked, Claude adds a
  quick score out of ten when it answers Max, for how well the work splits into clear pieces; score/10 × 0.9 over 0.7
  sends High to plan, then Medium for each piece, in the same conversation. Otherwise Max stands. The choice is kept for
  new sessions.
- The pane shows the last score and what it sent while the option is on.
- Tests: reading the score, the gate at its edges, off by default, and on from Settings.
- **Settings fields read as plain words.** Each condition shows its real number ("4 or more files…") instead of a
  `{n}` placeholder. Write what you want; a number you type becomes that condition's count, and Easier, Harder and
  the weekly budget still move it from there. A number inside a word or a longer number (v2, 1.5) is never taken.
- The plugin's types file is self-contained, so `claude plugin validate` passes.

## 1.2.0 (2026-10-16)

Turn it off and on from the pane.

- A **Turn off** / **Turn on** button beside **Settings**. Off, the pane shows **Off** and says what that means: Claude
  Code keeps its own effort and nothing is added beside your prompts.
- Off or on is now remembered for new sessions, from the button and from `/adaptive-effort off` / `on` alike; before,
  every new session started on.
- The README explains how to turn it on and off, near the top.
- Tests: the button, the choice kept for a new session, and the command turning it back on.

## 1.1.0 (2026-10-16)

Claude weighs the cost before it picks a level.

- Beside every prompt, the line now shows your weekly usage (used, left, hours left, allowed per day against spent per
  day) and this session's calls and output tokens of the last hour, by level.
- One cost rule for the pace you are on: faster than the week allows, the lower level when two fit; close to the pace,
  the level the conditions name; with room, a higher level the conditions support is affordable. Usage never raises a
  level the conditions do not support.
- Generic project signals: no tests, production, security or payment code, a shared or public repository, or unread
  code raise the answer one level, never to max on these alone.
- Every condition now comes in a version for code work and one for any other work, in specific, countable words.
- A **Settings** button beside "Effort now" lets you rewrite each condition (`{n}` for the count) and reset them to
  the defaults; your texts are saved for every session. The level cards no longer print the conditions: each shows a
  short definition of its level, and your setting only when you changed it. "Standard" now reads "default".
- Where several levels fit, Claude chooses among them by the work and the usage; the pace gives a lean, not an order.
- The recent spending rate is steadier: a weekly figure that has not moved yet no longer reads as zero spending, and a
  single step no longer reads as a burst.
- Tests: the usage figures and the lean per pace, the last hour's output by level, the line beside the prompt, both
  versions of every condition with the counts in force, saved definitions read back only in their shape, Settings
  saving, keeping and resetting definitions, and the rate from rises of the weekly figure.

## 1.0.2 (2026-10-16)

Watch your usage live in the pane.

- A chart of output tokens per 15 minutes, stacked by effort level, in a frame of fixed size that fits 24 hours.
- A table of the levels used: calls, output per call and share of all output.
- Each session's chart is kept for 24 hours in local plugin storage, saved at most once a minute and at session end,
  so it comes back after an app restart; a plugin reload keeps every call. Older charts are deleted.
- The pane is easier to read: the effort as a coloured pill, one card per level, grey text and the budget warning in
  amber.
- Tests: the chart's buckets, deletion, table, frame and drawing, and the restart and reload paths.

## 1.0.1 (2026-10-16)

Fixes to the 10-minute max limit.

- A max answer spent by its 10 minutes now stays medium on the next prompt. Before, a new prompt sent max again for
  another 10 minutes. Claude has to answer max again to get it back.
- A max run that ran out while the session sat idle no longer blocks a new max answer.
- `/adaptive-effort` names the loaded version, so each session shows which build it runs.
- Tests: seven stories for the max limit and the version line, plus a seeded random sweep of 6,000 events that checks
  the rules after every step.

## 1.0.0 (2026-10-15)

First public release.

- Claude picks its own reasoning effort (medium, high, xhigh, max) by counted rules and answers with
  `echo "EFFORT=<level>"`; the mod sends that level on the next steps.
- Thinking effort pane: make max, xhigh or high harder or easier to reach (from easier -2 to harder +3), save as
  default, reset to standard.
- Limits: 60 seconds between changes; max for at most 10 minutes, then medium until the next prompt.
- Weekly budget step: over budget, every count in the rules is one higher.
- Subagent note past half of the weekly limit.
- Opus, Fable and Sonnet 5 and later range from medium to max.
- No model calls and no network requests.

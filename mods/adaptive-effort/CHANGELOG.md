# Changelog

All notable changes to adaptive-effort. Versions follow [Semantic Versioning](https://semver.org): a new major version
changes behaviour you rely on, a minor version adds features, a patch fixes bugs.

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

# Changelog

All notable changes to adaptive-effort. Versions follow [Semantic Versioning](https://semver.org): a new major version
changes behaviour you rely on, a minor version adds features, a patch fixes bugs.

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

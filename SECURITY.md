# Security policy

## Reporting a vulnerability

Please report security problems **privately**, not in a public issue:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Describe the problem, the tool it affects, and how to reproduce it.

You will get an answer as soon as possible. Please give a reasonable time for a fix before sharing details publicly.

## What counts

- A tool that runs code, reads files or sends data that its README does not describe.
- A way to make a tool leak keys, tokens, personal paths or private data.
- A dependency or setting in this repository that weakens the safety of people who use it.

## Supported versions

Only the latest version on the `main` branch is supported.

## For contributors

Never commit keys, tokens, passwords, personal paths or machine-specific settings. GitHub's secret scanning and push
protection are on for this repository and will block a push that holds a known secret.

# Contributing

Thanks for taking a look at Blitztext macOS Preview.

This repository is intentionally a preview. Contributions should make it easier to learn from, build, fork, or safely extend.

## Good First Contributions

- improve build instructions
- fix confusing UI text
- improve error messages
- add tests around parsing or quality filters
- document local model experiments
- simplify setup

## Before Opening A Pull Request

Please include:

- what changed
- why it changed
- how you tested it
- whether you used AI-assisted coding tools

Keep changes small when possible. Avoid unrelated cleanup in the same PR.

## Local Build

```bash
./build.sh --debug
```

For a quick compile check, add `--fast`. The build then covers only your own
machine's architecture and skips `clean`:

```bash
./build.sh --debug --fast
```

Always build without `--fast` for anything you hand out: a fast build is not
universal.

## Continuous Integration

A pull request runs the `CI` workflow only: secret scan on Linux, a macOS debug
build for the runner's architecture, and the Windows frontend plus a Rust debug
build without installers. These are compile checks, not artifacts.

Universal macOS builds, Windows installers, signatures, and releases are
produced on a push to `main` and on a version tag.

If you need a downloadable test build on the pull request itself, add the
`build-artifacts` label. Both release workflows then run for that PR and attach
their artifacts to the run. You can also start them with "Run workflow" on the
branch.

## Security And Privacy

- Never commit API keys, tokens, private audio, or confidential transcripts.
- Avoid adding telemetry, hosted services, or external dependencies without a clear issue first.
- Call out privacy-impacting changes in the pull request description.
- Keep the preview honest: do not describe remote OpenAI workflows as offline or local.

## Project Boundaries

This preview currently does not include:

- other platforms
- a hosted backend
- packaged releases
- bundled local model files
- local text rewriting

Those can be discussed in issues, but please keep PRs focused on the current macOS preview unless a maintainer agrees on a larger direction first.

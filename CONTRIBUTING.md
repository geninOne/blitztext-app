# Contributing

Thanks for taking a look at Blitztext.

Contributions should make Blitztext better to use, easier to learn from, build, fork, or safely extend.

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

A pull request runs the `CI` workflow only: `Secret hygiene` on Linux,
`macOS compile check` (debug build for the runner's architecture), and
`Windows compile check` (frontend plus a Rust debug build, no installers).
These are compile checks, not artifacts.

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
- Keep it honest: only describe something as local if it really runs on the device.

## Project Boundaries

Blitztext currently does not include:

- other platforms (the iOS app is not public yet; Linux and Windows ports live in their own community projects, see the README)
- a hosted backend or accounts
- bundled model files (models are downloaded once on first use)

Those can be discussed in issues, but please keep PRs focused on the macOS app unless a maintainer agrees on a larger direction first.

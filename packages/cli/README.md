# @skeptrune/skcal

Command-line client for [skcal](https://skcal.skeptrune.com), a calorie and
body-composition tracker built for developers and AI power users. Logs
weigh-ins, meals, and measurements and prints your daily snapshot — straight
from the terminal, so you can wire it into scripts and your AI tooling. (Pairs
with the typed HTTP API; an MCP server is on the roadmap.)

`skcal login` opens your browser, you sign in, and a short-lived token is cached
locally and replayed on every request.

## Install

```bash
npm install -g @skeptrune/skcal   # or: npx @skeptrune/skcal <cmd>
```

Or grab a standalone binary (no Node required) for your platform from the
[latest release](https://github.com/skeptrunedev/telemetry/releases).

## Usage

```bash
skcal login                      # browser sign-in; caches the token
skcal whoami                     # signed-in account + token expiry
skcal status                     # today: weight, S:W ratio, calories/protein

skcal weight log 158.2           # log a weigh-in in pounds (--kg for kilograms)
skcal weight log 72 --kg --bf 17 --note "morning, fasted"
skcal weight list -n 10          # recent weigh-ins
skcal weight note 42 re-weighed  # set/clear a note on reading #42

skcal meal describe "chicken breast + toum, skipped the salad"  # AI macros
skcal meal list                  # meals logged today (--date YYYY-MM-DD)

skcal measure waist 32.5         # inches (--cm for centimetres)
skcal targets                    # your goals

skcal logout
```

Point at a different deployment with `skcal login --url https://example.com`.
Credentials live in `~/.config/skcal/credentials.json` (override with
`SKCAL_CONFIG_DIR`).

## Develop

```bash
npm install
npm run build        # bundle to dist/index.js (tsup)
npm run typecheck
npm run binaries     # standalone per-platform binaries (pkg) -> binaries/
```

Releases are automated: conventional-commit merges to `main` open a Release
Please PR; merging it tags `cli-vX.Y.Z`, publishes to npm, and attaches binaries
to the GitHub Release.

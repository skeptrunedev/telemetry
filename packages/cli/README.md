# @skeptrune/telemetry-cli

Command-line client for the [Telemetry](https://telemetry.skeptrune.com)
body-recomposition API. Logs weigh-ins, meals, and measurements and prints your
daily snapshot — straight from the terminal.

Authentication is **browser SSO via Cloudflare Access** — no API key. `telemetry
login` opens your browser, you sign in, and a short-lived Access token is cached
locally and replayed as the `cf-access-token` header on every request.

## Install

```bash
npm install -g @skeptrune/telemetry-cli   # or: npx @skeptrune/telemetry-cli <cmd>
```

Or grab a standalone binary (no Node required) for your platform from the
[latest release](https://github.com/skeptrunedev/telemetry/releases).

## Usage

```bash
telemetry login                      # browser SSO; caches the Access token
telemetry whoami                     # signed-in account + token expiry
telemetry status                     # today: weight, S:W ratio, calories/protein

telemetry weight log 158.2           # log a weigh-in in pounds (--kg for kilograms)
telemetry weight log 72 --kg --bf 17 --note "morning, fasted"
telemetry weight list -n 10          # recent weigh-ins
telemetry weight note 42 re-weighed  # set/clear a note on reading #42

telemetry meal describe "chicken breast + toum, skipped the salad"  # AI macros
telemetry meal list                  # meals logged today (--date YYYY-MM-DD)

telemetry measure waist 32.5         # inches (--cm for centimetres)
telemetry targets                    # your goals

telemetry logout
```

Point at a different deployment with `telemetry login --url https://example.com`.
Credentials live in `~/.config/telemetry/credentials.json` (override with
`TELEMETRY_CONFIG_DIR`).

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

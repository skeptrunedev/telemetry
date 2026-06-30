# Design

## Theme

A direct Hacker News pastiche: a body-recomp tracker wearing HN's exact chrome. Orange title bar, tan canvas, Verdana, no cards, no rounded corners, no shadows. Log entries render like HN "stories": a rank number, a black title line, and a gray subtext line carrying metadata and action links. Deliberately a costume — the homage IS the design.

## Color

HN's literal palette.

| Role | Value | Use |
| --- | --- | --- |
| `--bg` | `#f6f6ef` | Body canvas (HN beige) |
| `--bar` | `#ff6600` | Top bar + footer rule (HN orange) |
| `--surface` | `#f6f6ef` | Same as bg — no cards |
| `--inset` | `#ffffff` | Form inputs only |
| `--line` | `#e0e0d8` | Faint divider when one is truly needed |
| `--fg` | `#000000` | Titles / primary text |
| `--muted` | `#828282` | HN subtext gray (dates, metadata, action links) |
| `--barink` | `#000000` | Text on the orange bar |
| `--barink-2` | `#1d1d1d` | Slightly softer bar text (right-side user) |
| `--good` | `#2f7d4f` | On-track |
| `--attention` | `#9a4a00` | Watch / over |
| `--info` | `#3b5998` | Neutral status / visited-link feel |
| `--alert` | `#b3261e` | Error / destructive |

Strategy: **committed** — the orange bar is a saturated band of brand; everything below is HN beige + black + subtext gray. Orange appears only in the bar, the footer rule, and the rank/active marker.

## Typography

HN's font stack, small sizes. No web fonts.

- `--sans`: `Verdana, Geneva, "DejaVu Sans", sans-serif` — everything.
- `--mono`: `ui-monospace, Menlo, Consolas, monospace` — only where columnar numerals genuinely help.
- Base ~13px. Titles ~13–15px (not a giant hero number; HN has no hero). Subtext ~11px gray. Bar text ~13px, site name bold.
- Sentence case. No uppercase tracked labels, no display face.

## Layout

- **Top bar (HN)**: solid `--bar` orange, ~24–28px tall, padding 2px 6px. Left: a bordered square logo box with a bold letter, then the bold site name `Telemetry`, then inline nav links separated by ` | ` — `today | body | food | photos | add`. Right (pushed): `dev@local | logout` (the account, as HN shows the user). All bar text black; active nav link bold/underlined. This is the ONLY nav.
- **Canvas**: HN beige, content in a centered column (`max-width ~760px`, the app may use ~85% feel). No cards, no borders around sections — content sits directly on the beige.
- **Footer**: a 2px orange horizontal rule, then small centered gray links (`openapi · cli · switch account`) and an optional disabled "Search:" box, echoing HN's footer.
- App is a fixed shell (orange bar pinned, one scroll region for the active tab) with a footer at the end of the scroll.

## Components

- **Story item** (the core unit — weigh-ins, meals, measurements): `rank.` in gray, then a black title (e.g. `158.2 lb`, `615 kcal · 58 g protein`, `Waist 32.5 in`), then a gray subtext line below with ` | `-separated metadata and action links (`edit`, `delete`), exactly like HN's `points | user | time | comments`. Optional small triangle glyph (▲) before rank as static flavor — never a fake interactive vote.
- **Nav / action links**: plain text links, black on bar / HN-blue-gray elsewhere; hover underline. `add` is a nav link that opens the sheet (no button chrome, no FAB).
- **Bars** (calories/protein/range): thin 2px-radius track, orange or status fill — used sparingly; prefer a text ratio (`615 / 1850`) in HN style.
- **Sheet** (add flow): a plain white-inset box with a 1px border, Verdana labels; bottom sheet on mobile, centered ≥900px. No glass, no rounded-pill chrome.

## Motion

Effectively none — HN doesn't animate. Instant tab switches; at most a ≤100ms link hover. `prefers-reduced-motion: reduce` is a no-op because there's nothing to reduce.

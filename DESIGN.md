# Design

## Theme

Utilitarian light UI in the spirit of Hacker News: a light near-neutral page, near-black text, hairline rules, and a single muted accent. No gradients, shadows, glass, grain, or decorative motion. Density and legibility over polish.

## Color

Light, near-neutral, one accent. Values are sRGB hex (kept simple to match the plain tone).

| Role | Value | Use |
| --- | --- | --- |
| `--bg` | `#f7f7f4` | Page background (faint warm-neutral, low chroma) |
| `--surface` | `#ffffff` | Panels / rows |
| `--surface-2` | `#efefea` | Inset fields, active tab fill |
| `--line` | `#e1e1da` | Hairline borders + dividers |
| `--fg` | `#1b1b19` | Primary text (contrast ~13:1 on bg) |
| `--muted` | `#67675f` | Secondary text (≥4.5:1 on bg) |
| `--dim` | `#8f8f86` | Labels / least-emphasis (large/again-text only) |
| `--accent` | `#c0490d` | The one accent: links, active nav, primary action |
| `--good` | `#2f7d4f` | On-track |
| `--attention` | `#b4530a` | Watch / over |
| `--info` | `#27598f` | Neutral status |
| `--alert` | `#b3261e` | Error / destructive |

Strategy: **restrained** — neutral surface, accent under ~10% of the screen, used only for interactive/active states.

## Typography

System fonts only (no web-font payload); hierarchy comes from size + weight, not family.

- `--sans`: `system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif` — everything.
- `--mono`: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` — numeric data, units, labels.
- No display face. Big numbers are the sans at a heavier weight with `tabular-nums`.
- Labels: small mono, sentence or lower case; uppercase only for ≤2-word tags.

## Layout

- **One navigation surface**: a fixed top bar. Left: wordmark. Center/left: text tabs `Today · Body · Food · Photos`. Right: an `Add` action button + the account monogram. Active tab marked by an accent underline. No bottom bar, no FAB, no in-page segmented control.
- App is a fixed shell (`100dvh`, header pinned) with one scroll region for the active tab.
- Content is flat blocks separated by hairline rules, not nested cards. Where a container is needed, it's a 1px border at ~8px radius with no shadow. Dense rows with tabular numbers aligned right.

## Components

- **Top nav**: text links; active = `--accent` text + 2px underline; hover = ink. Add button is a bordered text button (`+ Add`), not a circle.
- **Rows**: label left (mono, muted), value right (sans, tabular). Divided by `--line`.
- **Bars** (calories/protein/range): thin track in `--surface-2`, fill in status color, square-ish.
- **Sheet** (add flow): bottom sheet on mobile, centered dialog ≥900px; plain border, no glass.
- **Buttons**: primary = `--accent` fill, white text; secondary = bordered, ink text. Press = slight opacity, no scale-bounce.

## Motion

Incidental only: instant tab switches, ≤120ms opacity/transitions on hover/press. No entrance staggers, parallax, or springy effects. `prefers-reduced-motion: reduce` removes all transitions.

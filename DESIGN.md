# Design

## Theme

A standard, calm dark dashboard. Flat graphite surfaces, a single warm amber accent, clean system type. No gradients, grain, glass, or loud color. The interface gets out of the way of the numbers.

## Color

Dark, near-neutral, one accent (sRGB hex).

| Role | Value | Use |
| --- | --- | --- |
| `--bg` | `#17181a` | Page background |
| `--surface` | `#1f2123` | Cards |
| `--surface-2` | `#26282b` | Inset fields, avatar, tab fill |
| `--line` | `#303236` | Borders + dividers |
| `--fg` | `#ececec` | Primary text (~14:1 on bg) |
| `--muted` | `#9a9ca0` | Secondary text (~6:1 on surface) |
| `--dim` | `#6c6f73` | Least-emphasis labels |
| `--accent` | `#f59e0b` | The one brand accent |
| `--good` | `#46b97a` | On-track (muted, status only) |
| `--attention` | `#e0894a` | Watch / over |
| `--info` | `#5b9bd5` | Neutral status |
| `--alert` | `#e35d5d` | Error / destructive |

Strategy: **restrained** — amber appears only on the active nav item, the `+` Add, primary buttons, focus rings, links, and the weight range-bar fill / trend line. Everything else is graphite + ink + muted gray. Semantic status colors are used sparingly for genuine state, never as decoration.

## Typography

System fonts only; hierarchy from size + weight.

- `--sans`: `system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif` — body, headings, big numbers.
- `--mono`: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` — labels, units, metadata.
- No display/serif face. Big readouts are the sans at ~650 weight with `tabular-nums`. Labels are small uppercase mono.

## Layout

- **Standard stacked-card dashboard.** Top bar (wordmark + account monogram), a horizontal glance strip (Weight / S:W / Waist / Arm), then a single scrolling column of cards: weight hero (latest, insight line, trend chart, start→goal range bar, 7-day avg, note), shoulder:waist, measurements, nutrition vs target, food log. Trends is a separate view.
- **Navigation: one docked bottom bar.** Full-width, flat, pinned to the bottom edge with a 1px top border and the surface background — not a floating pill, no FAB. Three slots: **Today · Trends · `+` Add**; the `+` is the primary (amber) action and opens the add sheet. Active tab is amber. Content has bottom padding so the bar never overlaps the last card.
- Centered, `max-width ~520px` column on mobile and desktop alike (a focused single-column app, not a stretched grid).

## Components

- **Cards**: flat `--surface`, 1px `--line` border, ~12px radius, no shadow. Never nested.
- **Rows**: mono muted label left, sans tabular value right, divided by `--line`.
- **Bars** (calories / protein / range): thin `--surface-2` track, amber or muted-status fill.
- **Add sheet**: bottom sheet on mobile, centered dialog ≥900px; plain border, no glass. Cancel (bordered) + Save (amber).
- **Account**: monogram avatar opens a small popover with the email + "Switch account" — a deliberate two-step, never an instant logout.

## Motion

Subtle only: a gentle ~360ms staggered card fade-in on load, ≤150ms ease-out on hover/press. No parallax, bounce, or springy effects. `prefers-reduced-motion: reduce` removes transitions and entrance animation.

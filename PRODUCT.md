# Product

## Register

product

## Users

Developers and AI power users who want calorie and body-composition tracking wired into the tooling they already live in. They log a weigh-in, a meal, or a measurement in seconds — from the phone PWA, from the `skcal` CLI in a terminal, or programmatically against the typed HTTP API — and expect the same data to be reachable from a script, an agent, or a scheduled job (an MCP server is on the roadmap). They value signal, speed, and a clean API contract over polish, run their own tools, and are annoyed by anything that gets between them and the data.

## Product Purpose

A fast, private, integration-first calorie and body-composition tracker: weight, body measurements, nutrition (calories + protein), and progress photos. It exists so logging is frictionless and the numbers are legible at a glance — and so every one of those numbers is equally reachable through a CLI and a typed OpenAPI HTTP API (MCP planned), never trapped behind a UI. There is no wellness-app layer of motivation, gamification, or decoration. Success: a log takes a few taps or one command, the API contract is clean enough to script against, and the current state of every metric is readable in one screen with zero ceremony.

## Brand Personality

Utilitarian, terse, fast. Three words: plain, dense, honest. The interface reads like a well-made tool, not a product brochure: lowercase functional labels, real numbers, no marketing voice, no encouragement copy. Closest in spirit to Hacker News and craigslist-grade utility, dressed slightly more carefully.

## Anti-references

- **Glossy wellness apps** (Oura, Whoop): soft gradients, big hero rings, lifestyle polish, motivational tone.
- **Decorated dashboards**: glassmorphism, drop shadows, gradient accents, animation as default.
- **Playful / zine** (the project's own prior Risograph theme): grain texture, fluorescent accents, loud display type.
- **Competing navigation**: floating pill + FAB, in-page segmented controls layered on top of a tab bar, any two nav systems acting as peers.

## Design Principles

- **Content over chrome.** The data is the interface. Ornament is removed unless it improves legibility.
- **One nav, one accent.** A single navigation surface and a single muted accent color; never two of either.
- **Plain by default.** System type, hairline rules instead of cards-on-cards, semantic HTML. Reach for a heavier device only when function demands it.
- **Fast and legible.** Tabular numerals, high contrast, instant interactions; motion is incidental, never load-bearing.
- **Every element earns its place.** If a label, border, or animation isn't doing a job, it's cut.
- **Scriptable by default.** Anything you can do in the UI you can do from the CLI or the typed HTTP API; the data is never trapped behind the interface. The OpenAPI contract is a first-class surface, not an afterthought.

## Accessibility & Inclusion

Deliberately minimal, leaning on plain semantic HTML so accessibility largely falls out of the structure. Non-negotiables kept regardless: body text contrast ≥4.5:1 (no light-gray-on-tint), visible keyboard focus on every control, real `<button>`/`<a>`/landmark elements, and `prefers-reduced-motion` honored (there is little motion to begin with).

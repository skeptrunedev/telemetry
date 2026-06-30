# Product

## Register

product

## Users

A technical, self-directed person tracking body recomposition (currently the owner; later anyone who signs up). They open it on their phone several times a day to log a weigh-in, a meal, or a measurement in seconds, and to glance at whether the trend is going the right way. They value signal and speed over polish, run their own tools, and are annoyed by anything that gets between them and the data.

## Product Purpose

A fast, private body-recomposition tracker: weight, body measurements, nutrition (calories + protein), and progress photos. It exists so logging is frictionless and the numbers are legible at a glance, without a wellness-app layer of motivation, gamification, or decoration. Success: a log takes a few taps, and the current state of every metric is readable in one screen with zero ceremony.

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

## Accessibility & Inclusion

Deliberately minimal, leaning on plain semantic HTML so accessibility largely falls out of the structure. Non-negotiables kept regardless: body text contrast ≥4.5:1 (no light-gray-on-tint), visible keyboard focus on every control, real `<button>`/`<a>`/landmark elements, and `prefers-reduced-motion` honored (there is little motion to begin with).

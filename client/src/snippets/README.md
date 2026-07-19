# Snippets — reusable blocks

Small, independently importable pieces of the dashboard. Each file is
self-contained apart from the shared types (`src/types.ts`) and the
design system (`theme/`).

## Design system (start here)
| File | What it does |
|---|---|
| `theme/tokens.css` | All Kick colour tokens as CSS variables + base typography, `.tnum`, scrollbars, grid-layout theming. **The single source of truth — copy this first.** |
| `theme/tokens.ts` | The same tokens for JS: `vars.*` (CSS-var references), `hex.*` (raw, only where a chart lib insists), `cx.*` (class recipes: card, panel, microLabel, buttons, chip) |

Styling convention: components consume `var(--…)` only — never hex.
Green is an accent (CTAs, live state, key data), never a fill; `#53FC18`
always takes dark text.


## Hooks
| File | What it does |
|---|---|
| `hooks/useAnimatedNumber.ts` | Tweens a number on change; returns a `MotionValue<string>` for `<motion.span>` |
| `hooks/useAutoScroll.ts` | Scrolls a feed to bottom on new items, but only if the user is already near the bottom |
| `hooks/useWidgetLayout.ts` | Layout + hidden-set state for a react-grid-layout dashboard (drag/resize/hide, positions preserved while hidden) |

## UI primitives
| File | What it does |
|---|---|
| `ui/AnimatedNumber.tsx` | Big metric number that animates on change |
| `ui/StateChip.tsx` | `chatState()` + HOT/STEADY/DYING chip (icon + label, never colour alone) |
| `ui/Rel.tsx` | "1.7× normal" with direction arrow — relativises any metric |
| `ui/sentiment.ts` | Maps 0–1 sentiment to positive/mixed/negative label + icon + colour |
| `ui/Widget.tsx` | Widget shell: drag-grip header, optional title, hover hide button |
| `ui/WidgetGrid.tsx` | Full AWS-console-style dashboard: draggable/resizable widgets + "+ Widgets" checklist menu |

> WidgetGrid note: react-draggable reads `process.env.DRAGGABLE_DEBUG`, which
> Vite doesn't define — dragging throws without
> `define: { 'process.env.DRAGGABLE_DEBUG': 'undefined' }` in `vite.config.ts`.

## Charts
| File | What it does |
|---|---|
| `charts/HypeTimeline.tsx` | Area chart with normal-range band, hot/quiet zones, spike dots, and named-moment labels snapped to peaks |

## Chat
| File | What it does |
|---|---|
| `chat/userColor.ts` | Deterministic per-username colour |
| `chat/ChatMessage.tsx` | One chat row: badges, coloured name, emote chips |

## Actions
| File | What it does |
|---|---|
| `actions/VoteBars.tsx` | `useLiveVotes()` (simulated incoming votes) + animated vote bars |

## Panels (compositions of the above)
`panels/HypeHero.tsx` (number + chip + timeline), `panels/MetricsStrip.tsx`,
`panels/ShoutoutsPanel.tsx`, `panels/QuestionsPanel.tsx`, `panels/TopicsPanel.tsx`.

The app in `src/components/` is just these blocks composed:
`CenterPanel` = `WidgetGrid` + panels, `ChatPanel` = `useAutoScroll` + `ChatMessage`,
`ActionFeed` = cards + `VoteBars`.

# HowToMJ

Learn Singapore mahjong. Milestones 1–5 of the PRD: rules engine, hand scorer, discard advisor, lessons L1–L5, practice game vs 3 bots.

## Run

No install needed. Open `index.html` in a browser, or serve the folder:

```
powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1
```

then visit http://localhost:5173. Engine tests: `tests.html`.

## Files

| File | What it is |
| --- | --- |
| `engine.js` | Rules engine (no UI): tiles, win detection, tai, chip payouts, shanten, discard advice. Rule values live in `SG_DEFAULT` at the top. |
| `app.js`, `app.css`, `index.html` | App shell, hand scorer and discard advisor UI |
| `lessons.js` | Lesson content and quizzes (data only — edit text here) |
| `learn.js` | Lesson player: list, cards, quizzes, unlocking, saved progress |
| `ui.js` | Shared tile and hand drawing helpers |
| `game.js` | Practice game engine: wall, turns, claims, bots, kongs, bites, payouts, dealer rotation |
| `play.js` | Practice game table UI |
| `tests.js`, `tests.html` | Engine test suite |
| `serve.ps1` | Tiny local web server |

## Default rules

1 tai minimum, 5 tai cap. Chips: self-draw = each opponent pays (4/5/7/12/22), discard = shooter pays all (4/7/11/20/40).
Instant: kong added to pong 2 each, kong from discard 6 from shooter, concealed kong 4 each, bite 2 each (4 each in the starting hand).

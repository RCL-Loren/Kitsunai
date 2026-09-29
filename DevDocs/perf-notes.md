# Performance Notes (Milestone 4, 2026-09-29)

Measured in Chrome on macOS with `tools/mock-server.js`, streaming about 200 tokens/s in ~4-character deltas. Budgets are from plan §6.

## Results vs budgets

| Budget | Result | |
|---|---|---|
| No long tasks > 50 ms while streaming | **0** long tasks during a 7.8 s stream into the seeded conversation | ✅ |
| p95 frame work < 8 ms | Streaming paint (renderer flush + thoughts + scroll): **p50 0.2–1.0 ms, p95 1.6–3.2 ms, max 6.2 ms**. Once all 500 messages had been paged into the DOM: p95 3.2 ms | ✅ |
| Smooth frames | rAF gap p95 **17.4–17.5 ms** (60 fps); 1–2 frames over 25 ms per 7.8 s stream | ✅ |
| Input stays responsive | The composer's input handler costs **0.8 ms p50, 3.7 ms max** per keystroke. See the note on input delay below | ✅ |
| Open a 500-message conversation < 200 ms | Cold (empty HTML cache): **77 ms** of scripting, **126 ms** to the second painted frame. Warm: **~19 ms** to layout | ✅ |

## Old vs new streaming renderer

A synthetic benchmark streamed a 7.9 KB reply (seeded math, code and table answers) into a real, laid-out element, 4 tokens per frame over 494 frames:

| Per frame | p50 | p95 | max | Last 10 frames |
|---|---|---|---|---|
| Old: re-render the whole reply | 43.3 ms | 160.8 ms | 339.6 ms | 138 ms |
| New: frozen blocks + live tail | 0.6 ms | 6.7 ms | 18.5 ms | 1.8 ms |

The old cost grows with reply length, mostly from re-laying out every KaTeX span. The new cost depends only on the size of the unfinished block. The final `finish()` render of the same reply took 9.5 ms, once.

## History paging

- Opening a conversation renders the last 30 messages. Older ones load in pages of 30 when a marker 1200 px above the viewport becomes visible.
- Loading all 500 messages by jumping to the top took **5 pages in 208 ms**, with messages in order and the marker removed.
- **Scroll position:** the first version restored the reader's place by hand, and the message on screen still moved **255–350 px** per page. Off-screen messages (`content-visibility: auto`) are laid out at an estimated 240 px, and they changed size once rendered.
- **Fix:** rely on the browser's native scroll anchoring, removing the manual adjustment. The on-screen message now moves **0–1 px** per page.

## Measurement notes

- **Hidden windows:** Chrome stops `requestAnimationFrame` and `IntersectionObserver`, and clamps timers to 1 s, when the window is hidden. Frame and paging measurements need the window visible.
- **Input delay:** runs where the automation typed about 100 characters in one burst showed 120–216 ms long tasks and up to 259 ms of input delay. **The same happened with no stream running.** It comes from the synthetic burst plus a grammar-checker extension on the textbox, not from KitsunAI; the app's own handler is under 1 ms per keystroke.
- **Screenshots:** they add long tasks of their own, so budget runs were taken without them.
- **How to reproduce** (from the browser console):
  ```js
  const id = await kitsunai.debug.seed(500); location.hash = '#/chat/' + id;
  kitsunai.debug.startProfile(); /* send a message, type, scroll */ kitsunai.debug.stopProfile();
  ```
  Start the mock with `node tools/mock-server.js --tps 200 --reasoning --repeat 6` for long replies.

## Open

- **Latest pill:** in one exploratory run the "↓ Latest" pill was hidden after the stream ended while the view was scrolled up. A controlled rerun couldn't reproduce it; the pill stayed visible and the view held its place. Keep an eye on it.

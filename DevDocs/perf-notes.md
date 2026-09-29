# Performance Notes (Milestones 4 and 7, 2026-09-29)

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

## Edge cases (Milestone 7)

### A 5,000-line code block

An unclosed fence stays in the live tail, so the whole block used to be re-rendered every frame.

| Lines | Size | Live frame (before) | Final render (before) | Live frame (after) | Final render (after) |
|---|---|---|---|---|---|
| 500 | 31 KB | 3.1 ms | 50 ms | 0.1 ms | 36 ms |
| 1,000 | 63 KB | 6.0 ms | 77 ms | 0.1 ms | 6 ms |
| 2,500 | 161 KB | 15.7 ms | 201 ms | 0.3 ms | 15 ms |
| 5,000 | 324 KB | 31.3 ms | 383 ms | 0.5 ms | 31 ms |

Fixes:
- **Open fences append:** new code goes into text nodes in block-level chunks of 100 lines instead of re-rendering the block. A single growing text node still cost ~6 ms of layout per append; chunks bring that to ~0.1 ms, and off-screen chunks skip layout.
- **Code blocks over 32 KB are not highlighted.** highlight.js itself is only ~0.3 ms/KB. The real cost is parsing and laying out ~20k highlight spans, so a Worker wouldn't help.
- **`finish()` skips the whole-document comparison render** unless the text has reference-style link definitions.

End to end (mock `--code-lines 5000 --tps 3000`, 30 s): **0 long tasks**, paint work p50 1.1 ms / p95 1.7 ms, one 30 ms frame when the fence closed, and frame gaps p95 17.4 ms.

### A ~200 KB reply (2,000 formulas, ~55k DOM nodes)

- **Before:** 25 long tasks up to 465 ms in a fresh conversation. Long Animation Frames attribution showed forced layout inside `paint` (reading `scrollHeight` to follow the bottom) growing with the reply: the frozen part was one ever-growing block that kept being laid out.
  - A synchronous benchmark had hidden this, since it ran without rendering between steps.
- **Fix:** frozen blocks go into `.frozen-chunk` groups of 24 with `content-visibility: auto`. They are kept in the final DOM, because unwrapping cost a 1 s task. Messages from history over 48 blocks are chunked the same way, at the HTML-string level: moving built nodes into wrappers took ~1 s at this size.
- **After:** frame-by-frame benchmark 6–7 ms per frame, flat from start to end (was 15–36 ms average, up to 147 ms). End to end at 5,000 tok/s: 2 mid-stream long tasks (55–64 ms), plus 121 ms for the final render and save; frame gaps p95 17.4 ms.
- **Reopening** that conversation: 1,390 ms → **~540 ms cold, ~420 ms warm**. Most of what remains is the browser parsing ~97k nodes; lazy per-chunk rendering would be the next step if it matters. The initial jump now settles to the true bottom as chunk estimates resolve.
- **Test setup matters:** one run had ~557k DOM nodes (several 200 KB replies in one conversation). At that point style, layout and GC costs scale with the whole page, whatever the streaming algorithm does.

## Open

- **Latest pill:** in one exploratory run the "↓ Latest" pill was hidden after the stream ended while the view was scrolled up. A controlled rerun couldn't reproduce it; the pill stayed visible and the view held its place. Keep an eye on it.

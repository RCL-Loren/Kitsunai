# KitsunAI — Implementation Kickoff

## Recommended Model

| Milestones | Model | Why |
|---|---|---|
| 0–4, 6 | **Claude Opus 5.5** (Claude Code) | The provider spike, the math-plugin edge cases, the block-freezing streaming renderer, performance profiling and art direction all reward the strongest reasoning and design judgment. |
| 5, 7 | **Claude Sonnet 5** (optional, lower cost) | These milestones are well specified: settings, export, accessibility and edge-case hardening. Switch back to Opus if performance or visual problems come up. |

Using Opus 5.5 throughout is the simplest choice and is recommended if cost isn't a concern.

## Prompt

Paste this into a fresh Claude Code session at the repo root:

```
Implement KitsunAI according to DevDocs/KitsunAI-Development-Plan.md, using
DevDocs/KitsunAI-Project-Description.md as the source of product intent.

Ground rules:
- Read both documents fully before writing code.
- Work one milestone at a time, in order (0 → 7). Keep scope to the current milestone.
- Honor the constraints: vanilla ES modules, no framework/TypeScript/build step,
  vendored pinned libraries (markdown-it, highlight.js, KaTeX), zero runtime or dev
  npm dependencies, node:test for pure modules. Propose any new dependency with a
  justification before adding it.
- Keep pure modules (sse, math-plugin, blocks, markdown-export, openai request/parse)
  free of DOM access so they are testable in Node.
- Simplest implementation first; measure before optimizing beyond what the plan specifies.
- Ask before deviating from the data model, the conversation→model lock, or V1 scope.

Start with Milestone 0, including the provider CORS spike. Record findings in
DevDocs/provider-notes.md. If OpenCode Go blocks browser requests, stop and report
options to me instead of adding a proxy.

At the end of each milestone:
1. Run `npm test` (must pass).
2. Verify the milestone in a browser against tools/mock-server.js (use the
   claude-in-chrome tools if available; otherwise give me exact manual steps).
3. Commit with a clear message (no AI attribution or co-author trailers).
4. Give a short summary: what was built, how it was verified, open issues. Then
   wait for my go-ahead before starting the next milestone.
```

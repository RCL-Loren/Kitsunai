# KitsunAI

## Project Description

**KitsunAI** is a lightweight, beautiful, extremely responsive desktop-style LLM chat application built with modern vanilla JavaScript, HTML, and CSS.

Its design goal is simple:

> **The interface should never be the thing the user is waiting for.**

Interaction, scrolling, Markdown rendering, and streaming should feel instantaneous. Perceptible latency should come from the selected LLM, not the application.

KitsunAI uses a distinctive anime/Pokémon-inspired visual language without becoming cartoonish or sacrificing its usefulness as a serious technical tool.

The visual direction draws from polished Japanese game interfaces: expressive typography, restrained color, luminous accents, subtle animation, beautifully rendered technical content, and a small amount of personality.

The application deliberately avoids unnecessary architectural complexity. The initial implementation uses **modern JavaScript directly**, with no frontend framework, TypeScript, or native backend. Mature libraries handle specialized problems that should not be reinvented.

## Core Functionality

KitsunAI provides a familiar conversational interface with persistent chat history and real-time streaming responses.

Both **user messages and model responses are Markdown documents**. Once a user submits a message, it is rendered through the same Markdown pipeline used for model output.

The rendering system supports:

- Standard Markdown
- GitHub-style tables and lists
- Fenced code blocks
- Syntax highlighting
- Inline mathematics
- Display mathematics

For example, inline mathematics:

`$E=mc^2$`

and display mathematics:

$$  
H(s)=\frac{\omega_0^2}  
{s^2+2\zeta\omega_0s+\omega_0^2}  
$$

KaTeX provides high-speed mathematical typesetting.

The **original Markdown remains the canonical representation** of every message. Rendered HTML is only a view of that source.

Every response can therefore provide actions such as:

- **Copy**
- **Copy Markdown**
- **Export Markdown**

An entire conversation can similarly be exported as clean, Obsidian-ready Markdown, optionally including YAML frontmatter containing the conversation title, date, model, and other metadata.

## Models and Setup

KitsunAI includes a simple **Models** configuration screen.

The user can define multiple available models.

A model configuration contains approximately:

```
Name
Provider / API type
Endpoint
Model identifier
API key / authentication
Optional system prompt
Optional generation parameters
```

For example:

```
Models

✦ GPT-5.6
  OpenCode Go
  ● Ready

✦ Claude Sonnet
  OpenCode Go
  ● Ready

✦ Qwen3-VL 8B
  Local llama.cpp
  ● Ready

             + Add Model
```

The architecture should **not assume every model comes from OpenCode Go**.

A small provider abstraction should allow OpenAI-compatible endpoints, OpenCode Go, local servers, and future providers to be added without changing the chat system.

## Starting a Conversation

When creating a new conversation, the user selects the model:

```
          ✦ New Adventure ✦

        Choose your companion

       ┌───────────────────┐
       │   GPT-5.6         │
       │   OpenCode Go     │
       └───────────────────┘

       ┌───────────────────┐
       │   Qwen3-VL 8B     │
       │   Local           │
       └───────────────────┘
```

That selection becomes part of the conversation metadata.

> [!important]  
> **A conversation is permanently associated with one model.**

There is deliberately no model switching inside an existing conversation in V1.

This eliminates complexity involving:

- Context compatibility
- Model attribution
- Provider state
- Conversation semantics
- Provider-specific message representations

If the user wants to use another model, they start another chat.
## Performance Architecture

The active response should stream directly into the interface.

KitsunAI should avoid repeatedly rerendering an entire conversation while tokens arrive.

Completed messages are immutable.

Ideally, completed Markdown blocks within the active response also become immutable, leaving only the currently streaming block subject to repeated rendering.

Conceptually:

```
Completed response blocks
────────────────────────────

Paragraph 1       frozen
Equation 1        frozen
Code block 1      frozen
Paragraph 2       frozen

Current block
────────────────────────────

"The Fourier transform of..."
                         ▲
                    only this
                    gets updated
```

Token updates can be batched around the browser's animation cycle rather than triggering DOM work for every network fragment.

The performance target is not a synthetic throughput benchmark.

It is:

> **Maintain smooth 60 fps interaction while an LLM response is streaming.**

A conversation containing hundreds of previous messages should not materially affect the rendering cost of the current response.

Perceptible latency should originate from the model or network, not KitsunAI.

## Storage

For V1, IndexedDB stores:

- Conversations
- Messages
- Model configurations
- Application settings

The conceptual data model remains intentionally small.
### Conversation

```
id
title
modelId
createdAt
updatedAt
```

### Message

```
id
conversationId
role
markdown
createdAt
metadata
```

### Model

```
id
name
provider
endpoint
model
credentials
parameters
```

The model selected by `Conversation.modelId` cannot be changed after the first message.

No server-side account system or cloud database is required.

## Markdown as the Canonical Format

Markdown is not merely an export format.

It is the application's **native content representation**.

The flow is:

```
User input ──────────────┐
                         │
LLM response ────────────┼──► Markdown source
                         │
                         ├──► Screen renderer
                         │
                         ├──► Clipboard
                         │
                         ├──► Persistence
                         │
                         └──► Obsidian export
```

This eliminates unnecessary conversion between application-specific rich-text formats and Markdown.

A message containing:

```
The transfer function is

$$
H(s)=\frac{\omega_0^2}
{s^2+2\zeta\omega_0s+\omega_0^2}
$$

where $\zeta$ is the damping ratio.
```

is stored exactly that way.

The renderer transforms it for display.

**Copy Markdown** returns the original.

**Export Markdown** writes the original.

No HTML-to-Markdown reconstruction is required.

## Obsidian Export

Individual messages can be exported directly as `.md` files.

Entire conversations can also be exported.

A conversation export might resemble:

```
---
title: "Plasma Source Discussion"
date: 2026-09-29
model: GPT-5.6
tags:
  - llm-chat
  - plasma
---

# Plasma Source Discussion

## Loren

Suppose the magnetic field is approximately...

## Assistant

For an electron moving perpendicular to the field,

$$
r_L = \frac{m_e v_\perp}{eB}
$$

...
```

Because Markdown is already canonical, Obsidian export should require very little transformation.

Future versions could support additional Obsidian features such as:

- `[[wikilinks]]`
- Callouts
- YAML properties
- Tags
- Attachments
- Vault-aware export
- Conversation linking

## Visual Identity

KitsunAI should have personality.

It should **not** look like a generic SaaS application with a purple gradient.

It also should not become an interface plastered with Pokémon imagery.

The inspiration should come from **high-quality anime game interfaces and Japanese RPG menus**.

Potential visual characteristics include:

- Deep ink colors
- Warm whites
- Electric accent colors
- Soft luminous borders
- Restrained gradients
- Slightly exaggerated card geometry
- Subtle glow around selected elements
- Smooth, restrained animation
- High-quality typography (using open source fonts with best practices)

A small stylized kitsune spirit can serve as the application's mascot.

It should appear sparingly:

- Empty state
- Initial setup
- Thinking/generation indicator
- Errors
- Setup completion
- Application icon

Streaming could use a tiny animated kitsune flame or tail indicator instead of a generic:

`Generating...`

There is room for playful language without making the application obnoxious.

For example:

> **What are we exploring today?**

or, during model selection:

> **Choose your companion.**

Normal application controls should remain normal application controls.

Settings should still say **Settings**.

The anime influence should primarily come from **art direction, motion, typography, illustration, and personality**, rather than renaming ordinary UI concepts.

## V1 Technology Stack

The technical stack should remain deliberately small.

```
HTML
CSS
Modern JavaScript / ES modules

markdown-it       Markdown rendering
KaTeX             Mathematics
highlight.js      Code highlighting
IndexedDB         Persistence
fetch()           LLM streaming
```

Initially:

- No React
- No Vue
- No Svelte
- No TypeScript
- No Rust
- No Go
- No C++
- No native backend
- No application server
- No SQLite
- No unnecessary build system

A dependency should be introduced only when it **eliminates more complexity than it introduces**.

## Architectural Principle

KitsunAI should begin as a browser-native application.

```
             KitsunAI

       HTML + CSS + JavaScript
                │
        ┌───────┴───────┐
        │               │
    LLM APIs        IndexedDB
        │
        ▼
      stream
        │
        ▼
   markdown-it
        │
      KaTeX
        │
        ▼
       DOM
```

Native packaging can be considered separately once the core application exists.

The browser application should not depend upon its eventual packaging technology.

This leaves open future deployment through:

- Browser
- PWA
- Electron
- Tauri
- Another lightweight native WebView shell

without requiring the core application to be rewritten.

## V1 Design Philosophy

KitsunAI should aggressively favor simplicity.

Do not add infrastructure in anticipation of problems that have not occurred.

Do not add a framework because this is a web application.

Do not add native code because performance is important.

Do not add a database because conversations need persistence.

Do not add abstraction merely because something might change someday.

Instead:

1. Build the simplest implementation that satisfies the requirement.
2. Measure its behavior.
3. Identify actual bottlenecks.
4. Optimize those bottlenecks.
5. Introduce additional machinery only when there is evidence that it solves a real problem.

## Product Definition

> [!abstract] KitsunAI  
> **A beautiful, anime-inspired, local-first LLM chat client built from boring web technology, optimized for extremely fast streaming, first-class technical Markdown, multiple configurable models, and frictionless Obsidian export.**

The application should feel **playful without being frivolous, technical without being sterile, and fast enough that the interface effectively disappears between the user and the model.**
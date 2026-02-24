# Sentinel Dashboard — UI Mockup

> Design decisions finalized before implementation.
> Simple is the best: single HTML + vanilla JS + Pico.css, no framework.

---

## Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Backend | Express.js REST API | Already Node.js project, minimal deps |
| Frontend | Single HTML + vanilla JS | No framework, no build step |
| Styling | Pico.css (classless CSS) | Clean defaults without writing CSS classes |
| Serving | `sentinel dashboard` → localhost | Local-only |
| Routing | URL hash (`#overview`, `#experiences`, etc.) | No page reloads |

---

## Navigation: Tab Bar

```
┌──────────────────────────────────────────────────────────────┐
│  Dev Sentinel                                                │
├──────────┬──────────────┬────────────────────────────────────┤
│ Overview │ Experiences  │ Drafts (3)                         │
├──────────┴──────────────┴────────────────────────────────────┤
│                                                              │
│  (selected tab content here)                                 │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

- 3 tabs, single HTML file
- Tab click shows/hides sections (JS)
- URL: `localhost:PORT/#overview`, `/#experiences`, `/#drafts`
- Drafts tab shows badge with pending count

---

## Tab 1: Overview

```
Overview
════════════════════════════════════════════════════════════════

┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│     12      │ │      3      │ │    ---%     │ │      0      │
│ Experiences │ │   Pending   │ │   Advice    │ │   System    │
│             │ │   Drafts    │ │  Effect.    │ │   Errors    │
│   3 evolved │ │             │ │  (soon)     │ │             │
└─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘
   (clickable → Experiences tab)  (clickable → Drafts tab)
```

### Data Sources

| Element | Source |
|---------|--------|
| Experience count | `getExperienceCount()` + count where `revision > 1` |
| Pending drafts | `getPendingDrafts().length` |
| Advice effectiveness | Feature 2 (show "---" until implemented) |
| System errors | `getPersistentErrors()` |

---

## Tab 2: Experiences

```
Experiences (12)
════════════════════════════════════════════════════════════════

  Sort: [Recent ▼]  [Most Revised]  [Alphabetical]

▶ #1  Jest mock leaking between tests              v2  Feb 24
▶ #2  Docker build cache invalidation              v1  Feb 23

▼ #3  TypeScript path alias not resolving           v2  Feb 22
  ┌──────────────────────────────────────────────────────────┐
  │ Issue                                                    │
  │   TypeScript path alias not resolving in Jest tests      │
  │                                                          │
  │ Failed Approaches                                        │
  │   • Added paths to tsconfig.json manually                │
  │   • tsconfig paths + jest moduleNameMapper               │
  │     (worked but duplicated config)                       │
  │                                                          │
  │ Solution                                                 │
  │   tsconfig-paths package — single source of truth        │
  │   from tsconfig.json                                     │
  │                                                          │
  │ Lessons                                                  │
  │   • Path alias config scattered across files → drift     │
  │   • Prefer single source of truth over manual sync       │
  │                                                          │
  │ Revision History (v2)                                    │
  │   v1  Feb 15  tsconfig paths + moduleNameMapper          │
  │   v2  Feb 22  tsconfig-paths package (evolved)           │
  └──────────────────────────────────────────────────────────┘

▶ #4  ESLint config inheritance in monorepo         v1  Feb 20
▶ #5  Docker compose volume permissions             v1  Feb 18
  ...
```

### Interactions

- Click row → toggle inline detail
- Sort buttons → re-sort list
- Revision history shown inline (from `experience_revisions`)
- **Read-only in MVP** (no edit button)

### Data Sources

| Element | Source |
|---------|--------|
| Experience list | `getAllExperiences()` |
| Revision history | `getRevisions(experienceId)` |

---

## Tab 3: Drafts

```
Drafts (3 pending)
════════════════════════════════════════════════════════════════

▼ #a1b2c3  Feb 24  "TypeScript path alias 문제"
  ┌──────────────────────────────────────────────────────────┐
  │ ⚡ Evolution candidate — matches Experience #xyz          │
  │                                                          │
  │ Issue                                                    │
  │   tsconfig path alias가 안 먹힘                           │
  │                                                          │
  │ Transcript (raw — LLM summary runs on confirm)           │
  │ ┌──────────────────────────────────────────────────────┐ │
  │ │ [user]  path alias가 또 문제야. 새 패키지 추가할     │ │
  │ │         때마다 두 군데 수정해야 해                     │ │
  │ │ [asst]  tsconfig.json의 paths 설정을 확인해          │ │
  │ │         보겠습니다...                                 │ │
  │ │ [user]  tsconfig-paths 패키지로 해결했어              │ │
  │ │ [asst]  좋습니다. tsconfig-paths를 사용하면...        │ │
  │ │ ...                                  (scroll ↓)      │ │
  │ └──────────────────────────────────────────────────────┘ │
  │                                                          │
  │  [✔ Confirm]   [✘ Reject]                                │
  └──────────────────────────────────────────────────────────┘

▶ #c3d4e5  Feb 23  "Docker cache invalidation"
▶ #e5f6g7  Feb 22  "ESLint monorepo config"


  ── Confirm Flow ──

  (after clicking Confirm)
  ┌──────────────────────────────────────────────────────────┐
  │ Processing...                                            │
  │                                                          │
  │ Step 1: Analyzing transcript with LLM...    ✔ done       │
  │ Step 2: Checking for evolution...           ⏳ running    │
  │ Step 3: Storing experience...               ○ pending    │
  │                                                          │
  └──────────────────────────────────────────────────────────┘

  (after completion)
  ┌──────────────────────────────────────────────────────────┐
  │ ✔ Experience evolved successfully                        │
  │   Experience #xyz updated to v2                          │
  │   (or: New experience stored as #abc)                    │
  └──────────────────────────────────────────────────────────┘
```

### Interactions

- Click row → toggle inline detail
- Transcript shown in scrollable box (max-height with overflow)
- **Confirm** → POST `/api/drafts/:id/confirm` → show step-by-step progress
- **Reject** → POST `/api/drafts/:id/reject` → remove from list
- After confirm/reject, item fades out from list and count updates

### Data Sources

| Element | Source |
|---------|--------|
| Draft list | `getPendingDrafts()` |
| Transcript content | Parse `transcriptData` JSON field |
| Confirm logic | Reuse `confirm-experience.ts` (existing) |

---

## REST API Endpoints

```
── Read ──────────────────────────────────────────────────────
GET  /api/overview         Stats for overview cards
GET  /api/experiences      All experiences
GET  /api/experiences/:id  Experience detail + revisions
GET  /api/drafts           Pending drafts
GET  /api/drafts/:id       Draft detail with transcript

── Write ─────────────────────────────────────────────────────
POST /api/drafts/:id/confirm   Confirm draft (triggers LLM)
POST /api/drafts/:id/reject    Reject draft

── Patterns ──────────────────────────────────────────────────
GET  /api/patterns              Cached analysis + meta
POST /api/patterns/analyze      Run new analysis (English base)
GET  /api/patterns/translate/:lang  Get/create translation
GET  /api/patterns/trend        Daily frustration counts
```

---

## Future Tabs (deferred)

### Sessions Tab
- Session list derived from `session_turns` GROUP BY `session_id`
- Inline timeline with frustration indicators
- Analyze Session / Create Draft actions
- Deferred: requires careful session derivation logic

### Patterns Tab (designed — next implementation)

On-demand LLM batch analysis of confirmed experiences.

**Analysis Flow:**
```
[New Analyze] click
    → LLM analysis (English, thinking model)
    → deep think if experiences >= 5
    → cache English base result in DB
    → display immediately

[Language dropdown] switch (English/Korean/Japanese/Chinese/Spanish)
    → cached translation exists? → show it
    → no cache? → LLM translate English base → cache → show
    → re-analyze invalidates all translation caches
```

**DB Schema (new tables):**
```sql
pattern_analyses:
  id, analysis_json (English base), experience_count, created_at

pattern_translations:
  analysis_id, language, translated_json, created_at
  PRIMARY KEY (analysis_id, language)
```

**LLM Prompt Design:**
- Output schema is fixed (JSON: insight, weakAreas, resolutionRate, recommendations)
- Analysis dimensions are NOT prescribed — LLM discovers categories from data
- Input: confirmed experiences + frustration trend (daily counts from session_turns)
- Language: always English for base analysis, translations separate

**UI Mockup:**
```
┌──────────────────────────────────────────────────┐
│  Patterns        Language: [English ▼]           │
│                  [New Analyze]                    │
│                  Last: Feb 22 · +3 new since then │
├──────────────────────────────────────────────────┤
│                                                  │
│  Sentinel Insight                                │
│  ┌──────────────────────────────────────────┐    │
│  │ "You consistently struggle with Docker   │    │
│  │  cache invalidation and TypeScript path  │    │
│  │  resolution. Your resolution rate has    │    │
│  │  improved from 60% to 78%..."            │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  Weak Areas              Frustration Trend       │
│  ┌───────────────┐       ┌──────────────────┐    │
│  │ Server Ops ██████ 5   │  ▁▂▁▃▅▂▁▄▂▁     │    │
│  │ Type System ████─ 3   │  (weekly)         │    │
│  │ Prompting  ███── 2    │                   │    │
│  └───────────────┘       └──────────────────┘    │
│                                                  │
│  Resolution Rate                                 │
│  ┌──────────────┐                                │
│  │ ██████░░ 72% │                                │
│  │ Resolved     │                                │
│  └──────────────┘                                │
└──────────────────────────────────────────────────┘
```

**API Endpoints (new):**
```
GET  /api/patterns              Cached analysis + meta (new experience count since)
POST /api/patterns/analyze      Run new analysis (English base)
GET  /api/patterns/translate/:lang  Get/create translation
GET  /api/patterns/trend        Daily frustration counts from session_turns
```

---

## Implementation Phases

### Phase 1: Foundation
- Express server + static HTML serving
- Tab navigation with hash routing
- Overview tab (cards, no activity feed yet)
- Pico.css integration

### Phase 2: Core Data
- Experiences tab (list + inline detail + revision history)
- Drafts tab (list + inline detail + confirm/reject)
- API endpoints for experiences and drafts

### Phase 3: Polish
- Confirm progress indicator
- Error states and loading states

### Phase 4: Patterns Tab
- DB schema: pattern_analyses + pattern_translations tables
- API: /api/patterns/* endpoints
- LLM analysis prompt (thinking model, deep think for >= 5 experiences)
- Translation flow (English base → on-demand translation with caching)
- UI: Sentinel Insight, Weak Areas bar chart, Frustration Trend, Resolution Rate
- Language selector (English/Korean/Japanese/Chinese/Spanish)

---

## Design Principles

1. **No build step**: HTML + JS served directly, no bundler
2. **Progressive enhancement**: Show what data exists, hide what doesn't
3. **Graceful degradation**: If LLM is down, everything except confirm still works
4. **Local-only**: No external requests from the dashboard
5. **Reuse existing logic**: confirm-experience.ts, frustration-analyzer, etc.

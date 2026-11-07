# Frontend: Marginalia

React single-page app for the paper summarizer: upload a research-paper PDF, read a structured summary next to
the PDF, and chat with the paper. Answers stream in and cite the pages they came from.

Stack: Vite · React 19 · TypeScript · Tailwind CSS v4 (+ typography) · react-pdf (pdf.js) · react-markdown + remark-gfm · lucide-react.

## Setup

Requires Node 20+ (tested with Node 25, npm 11).

```bash
cd frontend
npm install
```

### Run against the backend

Start the backend on port 8000 first (see `../backend/README.md`), then:

```bash
npm run dev
```

Open <http://localhost:5173>. The dev server proxies `/api` to `http://localhost:8000`. If the backend runs elsewhere, set
`API_TARGET`, for example `API_TARGET=http://localhost:8010 npm run dev`.

### Run without a backend (demo mode)

```bash
npm run dev:mock
```

This loads `.env.mock` (`VITE_MOCK=1`), which swaps the network for an in-browser mock of
[`docs/API_CONTRACT.md`](../docs/API_CONTRACT.md). It includes a seeded sample paper with a generated PDF, simulated
upload progress and processing, and streamed chat answers with citations. Upload any PDF to try the flow. A file whose
name contains `error` simulates a failed paper. The mock state resets when you reload.

### Other scripts

| Command | What it does |
|---|---|
| `npm run build` | Type-check (`tsc -b`) and build to `dist/` |
| `npm run lint` | ESLint (typescript-eslint, react-hooks) |
| `npm run preview` | Serve the production build |

## Features

- **Upload**: drag-and-drop anywhere in the window or use the file picker. The client checks type and size (≤ 25 MB) and
  shows an upload progress bar (XHR), then a skeleton while the backend processes the paper (polls every 1.5 s).
- **Split view**: the PDF viewer sits next to Summary / Chat tabs. On phones the panes become tabs (PDF · Summary ·
  Chat). The viewer lazy-renders pages and has zoom, page navigation and download.
- **Summary**: title, authors, keyword chips, abstract, then §1 Problem Statement, §2 Methodology, §3 Key Results
  (numbered), §4 Conclusion. Each section has **p. N** badges from `source_pages` that scroll the PDF to that page and
  flash it. Actions: copy as Markdown, download `.md`, print / save as PDF (dedicated print stylesheet), regenerate.
- **Chat**: SSE streamed over `fetch` + `ReadableStream` (POST, so `EventSource` can't be used), with Markdown and GFM
  tables. Inline `[p. N]` citations become clickable page chips. Each answer has a collapsible **Sources** list with the
  retrieved passages, relative relevance bars and the rewritten retrieval query, when the backend sends one.
  Suggested-question chips come from the summary. Also: Stop, retry after an error or stop, clear chat, export chat as
  Markdown, and per-paper history in `localStorage`.
- **Library** sidebar: previously uploaded papers with live status, filtering (shown once there are more than 4 papers)
  and delete with inline confirmation.
- **Polish**: light/dark theme (follows the OS until toggled, no flash on load), backend/LLM status pill, error toasts,
  empty state, keyboard shortcuts (<kbd>Enter</kbd> send, <kbd>Shift</kbd>+<kbd>Enter</kbd> newline, <kbd>/</kbd> focus
  the chat input).

## Design

The look aims for an academic reading room: Newsreader serif for headings and the abstract, Inter for UI text and
JetBrains Mono for labels and page refs. The palette is built from one warm parchment/bronze hue (OKLCH 65) with a
blue secondary for keywords. Between themes only lightness changes. Tokens live in `src/index.css` as CSS variables and
are mapped to Tailwind colors (`bg-surface`, `text-ink`, `text-primary`, …).

## Structure

```
src/
  api/client.ts        fetch wrappers, XHR upload with progress, SSE parser (streamChat)
  api/types.ts         types mirroring the API contract
  mock/                in-browser mock API, fixtures, tiny PDF generator (VITE_MOCK=1 only)
  hooks/               usePaper (polling), useChat (streaming + localStorage), useTheme, useMediaQuery
  lib/markdown.ts      citation linking, summary/chat → Markdown, downloads
  lib/storage.ts       try/catch-wrapped localStorage
  components/          Header, Library, UploadZone, PdfViewer, SummaryView, ChatPanel, Markdown, PageChip, Toasts, …
  App.tsx              layout, library state, upload/delete/regenerate, split view and tabs
```

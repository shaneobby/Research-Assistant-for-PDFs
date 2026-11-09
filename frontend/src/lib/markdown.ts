import type { ChatMessage, Paper, Summary } from '../api/types'

const PAGE_NUM = String.raw`\d{1,4}(?:\s*[–-]\s*\d{1,4})?`
// "p. 6", "pp. 6–7", "page 6", "pages 6, 8 and 9"
const MENTION_SRC = String.raw`\b(?:pp?\.|pages?)\s*${PAGE_NUM}(?:\s*(?:,|;|and|&)\s*${PAGE_NUM})*`
const MARKER_RE = /\b(?:pp?\.|pages?)/gi
const JOINER_RE = /\b(?:and|&)\b/gi
const GROUP_RE = /\[([^[\]\n]{1,200})\](?!\()|\(([^()\n]{1,200})\)/g

const chips = (pages: number[]) => pages.map((p) => `[p. ${p}](#page-${p})`).join(' ')
const BRACKET_RE = /\[([^[\]\n]{1,200})\](?!\()/g
// Models sometimes repeat a citation, as in "[p. 4] [p. 4]". Only chips separated by spaces or list punctuation collapse.
const REPEATED_CHIP_RE = /(\[p\. (\d+)\]\(#page-\2\))(?:[ \t]*[,;]?[ \t]*\1)+/g

/**
 * Turn page citations into links with a `#page-N` href, which the Markdown renderer shows as
 * clickable page chips. Handles `[p. 4]`, `[p.4, 7]`, `[pp. 3-5]`, `[page 2]` and the same mentions
 * inside parentheses or brackets with other text, e.g. `(p. 6)`, `(Table 1, p. 6)`, `(pp. 6–7)`,
 * `(see [p. 4])`. Ranges and lists give one chip per page. A page mention is only recognised with a
 * `p.`/`pp.`/`page(s)` marker inside a bracket or parenthesis group, so "step 6" or "(n = 6)" are
 * untouched. Pages below 1 or above `maxPage` (when given) never become chips and stay as typed.
 * Code spans and fenced blocks are left alone.
 */
export function linkCitations(md: string, maxPage?: number): string {
  const valid = (p: number) => p >= 1 && (maxPage === undefined || p <= maxPage)
  const pagesOf = (mention: string) =>
    expandPages(mention.replace(MARKER_RE, ' ').replace(JOINER_RE, ',')).filter(valid)
  const isPure = (inner: string) => inner.replace(new RegExp(MENTION_SRC, 'gi'), '').replace(/[\s,;]/g, '') === ''
  const hasMention = (inner: string) => new RegExp(MENTION_SRC, 'i').test(inner)
  const linkMentions = (inner: string) =>
    inner.replace(new RegExp(MENTION_SRC, 'gi'), (m) => {
      const pages = pagesOf(m)
      return pages.length ? chips(pages) : m
    })

  const parts = md.split(/(```[\s\S]*?```|`[^`\n]*`)/g)
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part // code
      const linked = part.replace(GROUP_RE, (whole, square: string | undefined, round: string | undefined) => {
        const inner = square ?? round ?? ''
        if (!hasMention(inner)) return whole
        if (isPure(inner)) {
          const pages = pagesOf(inner)
          return pages.length ? chips(pages) : whole
        }
        if (square !== undefined) return `[${linkMentions(inner)}]`
        // Parenthesised text may contain its own bracketed citation, e.g. "(see [p. 4])".
        const done: string[] = []
        const unwrapped = inner.replace(BRACKET_RE, (b, content: string) => {
          if (!hasMention(content) || !isPure(content) || !pagesOf(content).length) return b
          done.push(linkMentions(content))
          return `⟦${done.length - 1}⟧`
        })
        return `(${linkMentions(unwrapped).replace(/⟦(\d+)⟧/g, (_, n: string) => done[Number(n)])})`
      })
      return linked.replace(REPEATED_CHIP_RE, '$1')
    })
    .join('')
}

function expandPages(list: string): number[] {
  const out: number[] = []
  for (const piece of list.split(/[,;]/)) {
    const range = piece.trim().split(/\s*[–-]\s*/)
    const a = parseInt(range[0], 10)
    const b = range.length > 1 ? parseInt(range[1], 10) : a
    if (Number.isNaN(a)) continue
    if (Number.isNaN(b) || b < a || b - a > 20) out.push(a)
    else for (let p = a; p <= b; p++) out.push(p)
  }
  return [...new Set(out)]
}

const pagesNote = (pages?: number[]) => (pages?.length ? ` _(p. ${pages.join(', ')})_` : '')

export function summaryToMarkdown(paper: Paper, s: Summary): string {
  const sp = s.source_pages ?? {}
  const lines = [
    `# ${s.title || paper.filename}`,
    '',
    s.authors?.length ? `**Authors:** ${s.authors.join(', ')}` : '',
    '',
    s.keywords?.length ? `**Keywords:** ${s.keywords.join(' · ')}` : '',
    '',
    '## Abstract',
    '',
    s.abstract,
    '',
    `## Problem Statement${pagesNote(sp.problem_statement)}`,
    '',
    s.problem_statement,
    '',
    `## Methodology${pagesNote(sp.methodology)}`,
    '',
    s.methodology,
    '',
    `## Key Results${pagesNote(sp.key_results)}`,
    '',
    ...(s.key_results ?? []).map((r) => `- ${r}`),
    '',
    `## Conclusion${pagesNote(sp.conclusion)}`,
    '',
    s.conclusion,
    '',
    '---',
    `_Summary of ${paper.filename} (${paper.pages} pages), generated with Marginalia._`,
  ]
  return lines.join('\n').replace(/\n{3,}/g, '\n\n')
}

export function chatToMarkdown(paper: Paper, messages: ChatMessage[]): string {
  const title = paper.summary?.title || paper.filename
  const body = messages
    .map((m) => `### ${m.role === 'user' ? 'You' : 'Marginalia'}\n\n${m.content}${m.stopped ? '\n\n_(stopped)_' : ''}`)
    .join('\n\n')
  return `# Chat about: ${title}\n\n${body}\n`
}

export function downloadText(filename: string, text: string, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/\.pdf$/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'paper'
  )
}

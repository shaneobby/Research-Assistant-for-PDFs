import type { ChatMessage, Paper, Summary } from '../api/types'

/**
 * Turn inline citations such as `[p. 4]`, `[p.4, 7]`, `[pp. 3-5]` or `[page 2]` into links
 * with a `#page-N` href, which the Markdown renderer shows as clickable page chips.
 * Code spans and fenced blocks are left alone.
 */
export function linkCitations(md: string): string {
  const parts = md.split(/(```[\s\S]*?```|`[^`\n]*`)/g)
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part // code
      return part.replace(/\[(?:pp?\.|pages?)\s*([\d\s,–-]+)\](?!\()/gi, (whole, list: string) => {
        const pages = expandPages(list)
        if (!pages.length) return whole
        return pages.map((p) => `[p. ${p}](#page-${p})`).join(' ')
      })
    })
    .join('')
}

function expandPages(list: string): number[] {
  const out: number[] = []
  for (const piece of list.split(',')) {
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

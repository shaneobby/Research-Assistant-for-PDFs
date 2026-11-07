import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Paper, Summary } from '../api/types'
import { summaryToMarkdown } from '../lib/markdown'

/** Hidden on screen; the only thing shown when printing (see @media print in index.css). */
export function PrintSummary({ paper, summary }: { paper: Paper; summary: Summary }) {
  return (
    <div className="print-only prose max-w-none font-serif text-black prose-headings:font-serif prose-h1:text-3xl">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{summaryToMarkdown(paper, summary)}</ReactMarkdown>
    </div>
  )
}

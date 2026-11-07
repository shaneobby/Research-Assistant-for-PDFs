import { memo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { linkCitations } from '../lib/markdown'
import { PageChip } from './PageChip'

interface Props {
  children: string
  onJump?: (page: number) => void
  className?: string
}

/** Markdown with `[p. N]` citations rendered as chips that jump the PDF viewer. */
export const Markdown = memo(function Markdown({ children, onJump, className = '' }: Props) {
  const components: Components = {
    a({ href, children: kids, ...rest }) {
      const m = href?.match(/^#page-(\d+)$/)
      if (m) return <PageChip page={Number(m[1])} onJump={onJump} />
      return (
        <a href={href} target="_blank" rel="noreferrer noopener" {...rest}>
          {kids}
        </a>
      )
    },
    table({ children: kids }) {
      return (
        <div className="overflow-x-auto">
          <table>{kids}</table>
        </div>
      )
    },
  }
  return (
    <div className={`prose prose-paper max-w-none ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {linkCitations(children)}
      </ReactMarkdown>
    </div>
  )
})

import { memo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { linkCitations } from '../lib/markdown'
import { PageChip } from './PageChip'

interface Props {
  children: string
  onJump?: (page: number) => void
  className?: string
  /** Pages above this (or below 1) are not linked. */
  maxPage?: number
  /** When given, chips for pages outside this list are dimmed (page not in the retrieved sources). */
  sourcePages?: number[]
}

/** Markdown with `[p. N]` citations rendered as chips that jump the PDF viewer. */
export const Markdown = memo(function Markdown({ children, onJump, className = '', maxPage, sourcePages }: Props) {
  const components: Components = {
    a({ href, children: kids, ...rest }) {
      const m = href?.match(/^#page-(\d+)$/)
      if (m) return <PageChip page={Number(m[1])} onJump={onJump} dim={sourcePages ? !sourcePages.includes(Number(m[1])) : false} />
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
      <ReactMarkdown remarkPlugins={[remarkGfm]} disallowedElements={['img']} components={components}>
        {linkCitations(children, maxPage)}
      </ReactMarkdown>
    </div>
  )
})

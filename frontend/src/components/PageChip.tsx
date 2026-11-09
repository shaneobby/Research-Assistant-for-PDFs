interface Props {
  page: number
  onJump?: (page: number) => void
  size?: 'sm' | 'md'
  /** The page was not among the passages retrieved for this answer, so the citation is less trustworthy. */
  dim?: boolean
}

/** A small "p. N" badge; clicking it scrolls the PDF viewer to that page. */
export function PageChip({ page, onJump, size = 'sm', dim = false }: Props) {
  const cls =
    size === 'sm' ? 'px-1.5 py-px text-[0.7rem] align-[0.1em]' : 'px-2 py-0.5 text-xs'
  return (
    <button
      type="button"
      onClick={() => onJump?.(page)}
      title={dim ? `Page ${page} was not among the retrieved passages; verify in the PDF` : `Show page ${page} in the PDF`}
      className={`not-prose inline-flex items-center rounded-full border border-primary/30 bg-primary-soft font-mono font-medium text-primary no-underline transition hover:border-primary hover:bg-primary hover:text-canvas focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${dim ? 'opacity-50 border-dashed' : ''} ${cls}`}
    >
      p.&nbsp;{page}
    </button>
  )
}

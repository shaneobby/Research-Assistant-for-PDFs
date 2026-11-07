interface Props {
  page: number
  onJump?: (page: number) => void
  size?: 'sm' | 'md'
}

/** A small "p. N" badge; clicking it scrolls the PDF viewer to that page. */
export function PageChip({ page, onJump, size = 'sm' }: Props) {
  const cls =
    size === 'sm' ? 'px-1.5 py-px text-[0.7rem] align-[0.1em]' : 'px-2 py-0.5 text-xs'
  return (
    <button
      type="button"
      onClick={() => onJump?.(page)}
      title={`Show page ${page} in the PDF`}
      className={`not-prose inline-flex items-center rounded-full border border-primary/30 bg-primary-soft font-mono font-medium text-primary no-underline transition hover:border-primary hover:bg-primary hover:text-canvas focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${cls}`}
    >
      p.&nbsp;{page}
    </button>
  )
}

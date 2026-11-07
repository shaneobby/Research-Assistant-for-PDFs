// Types mirroring docs/API_CONTRACT.md.

export type PaperStatus = 'processing' | 'ready' | 'error'

export type SummarySection = 'problem_statement' | 'methodology' | 'key_results' | 'conclusion'

export interface Summary {
  title: string
  authors: string[]
  abstract: string
  problem_statement: string
  methodology: string
  key_results: string[]
  conclusion: string
  keywords: string[]
  suggested_questions: string[]
  source_pages: Partial<Record<SummarySection | string, number[]>>
}

export interface Paper {
  id: string
  filename: string
  pages: number
  created_at: string
  status: PaperStatus
  error: string | null
  summary?: Summary | null
}

export interface Health {
  status: 'ok'
  llm_provider: string
  model: string
}

export interface SourceChunk {
  id: string | number
  page: number
  text: string
  score: number
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatMessage extends ChatTurn {
  id: string
  sources?: SourceChunk[]
  error?: string
  stopped?: boolean
  createdAt: number
}

import type { Summary } from '../api/types'
import type { SamplePage } from './samplePdf'

export const SAMPLE_TITLE = 'Tidal Retrieval: Hybrid Sparse-Dense Search for Long Scientific Documents'

export const SAMPLE_SUMMARY: Summary = {
  title: SAMPLE_TITLE,
  authors: ['Ada Lindqvist', 'Rohan Mehta', 'Chiara Bellini', 'Tomás Okafor'],
  abstract:
    'Long scientific documents strain retrieval-augmented generation: dense retrievers miss exact terminology while ' +
    'lexical retrievers miss paraphrase. We present **Tidal**, a hybrid retriever that fuses BM25 and dense scores ' +
    'with reciprocal rank fusion and a page-aware re-ranker. On three long-document QA benchmarks Tidal improves ' +
    'answer accuracy by 7.4 points over the strongest single retriever while cutting context length by 38%.',
  problem_statement:
    'Question answering over research papers requires locating *specific* evidence (equations, dataset names, ' +
    'numeric results) inside documents of 10–40 pages. Existing RAG pipelines either rely on dense embeddings, ' +
    'which blur rare technical terms, or on keyword search, which fails on paraphrased questions. Neither ' +
    'reports **where** the evidence came from, which makes answers hard to verify.',
  methodology:
    'Tidal splits each paper into ~800-character passages that respect section boundaries and keeps page ' +
    'numbers as metadata.\n\n' +
    '1. **Dual retrieval**: BM25 over lemmatised tokens and a 384-d bi-encoder retrieve the top 20 passages each.\n' +
    '2. **Reciprocal rank fusion** (k = 60) merges both lists without score calibration.\n' +
    '3. **Page-aware re-ranking** boosts passages adjacent to already-selected pages to keep context coherent.\n' +
    '4. The generator is instructed to cite every claim as `[p. N]`.',
  key_results: [
    '**+7.4 accuracy** on average over the best single retriever across QASPER, LongBench-Sci and PaperQA-v2.',
    'Context sent to the LLM shrinks by **38%** at equal recall, lowering latency and cost.',
    'Citation precision of **91%**: cited pages contain the supporting evidence in 9 of 10 answers.',
    'Gains are largest on numeric and terminology questions (+12.1), smallest on summary questions (+2.3).',
  ],
  conclusion:
    'Fusing sparse and dense retrieval is a cheap, robust default for long-document QA, and page-level citations ' +
    'make answers auditable. Future work: table- and figure-aware chunking, and learning the fusion weights per domain.',
  keywords: ['retrieval-augmented generation', 'hybrid search', 'BM25', 'dense retrieval', 'long documents', 'citations'],
  suggested_questions: [
    'How does reciprocal rank fusion combine the two retrievers?',
    'What datasets were used for evaluation?',
    'What are the main limitations of the approach?',
  ],
  source_pages: {
    problem_statement: [1, 2],
    methodology: [3, 4],
    key_results: [5, 6],
    conclusion: [8],
  },
}

export const SAMPLE_PAGES: SamplePage[] = [
  {
    heading: 'Abstract',
    lines: [
      'Long scientific documents strain retrieval-augmented generation.',
      'We present Tidal, a hybrid retriever fusing BM25 and dense scores.',
      'Authors: A. Lindqvist, R. Mehta, C. Bellini, T. Okafor.',
    ],
  },
  { heading: '1 Introduction', lines: ['Dense retrievers blur rare technical terms.', 'Lexical retrievers miss paraphrase.'] },
  { heading: '2 Related Work', lines: ['Prior hybrid systems calibrate scores with learned weights.'] },
  { heading: '3 Method', lines: ['Passages of ~800 characters keep page metadata.', 'Reciprocal rank fusion with k = 60.'] },
  { heading: '4 Experiments', lines: ['Benchmarks: QASPER, LongBench-Sci, PaperQA-v2.', 'Average gain: +7.4 accuracy.'] },
  { heading: '5 Results', lines: ['Context length reduced by 38% at equal recall.', 'Citation precision: 91%.'] },
  { heading: '6 Analysis', lines: ['Numeric questions gain +12.1; summary questions +2.3.'] },
  { heading: '7 Conclusion', lines: ['Hybrid retrieval is a robust default.', 'Limitations: tables and figures are not chunked.'] },
]

/** Canned answers keyed by topic; the mock picks one by keyword. */
export const MOCK_ANSWERS: { match: RegExp; answer: string; pages: number[] }[] = [
  {
    match: /fusion|rrf|combine|merge/i,
    pages: [3, 4],
    answer:
      'Tidal runs **two retrievers in parallel** and merges their rankings with *reciprocal rank fusion* (RRF) [p. 3].\n\n' +
      'For every passage, RRF adds `1 / (k + rank)` from each list, with **k = 60** [p. 4]. Because only ranks are ' +
      'used, the BM25 and cosine scores never need to be calibrated against each other.\n\n' +
      '| Step | Output |\n|---|---|\n| BM25 | top 20 passages |\n| Dense (384-d) | top 20 passages |\n| RRF | fused list |',
  },
  {
    match: /dataset|benchmark|evaluat/i,
    pages: [5],
    answer:
      'The authors evaluate on three long-document QA benchmarks [p. 5]:\n\n' +
      '- **QASPER**: questions written by NLP researchers about full papers\n' +
      '- **LongBench-Sci**: the science subset of LongBench\n' +
      '- **PaperQA-v2**: multi-hop questions across sections\n\n' +
      'Averaged over all three, Tidal gains **+7.4** accuracy points [p. 5].',
  },
  {
    match: /limit|weakness|future/i,
    pages: [7, 8],
    answer:
      'The paper names two main limitations [p. 8]:\n\n' +
      '1. Tables and figures are not chunked separately, so numbers inside tables are hard to retrieve.\n' +
      '2. The fusion constant is fixed rather than learned per domain.\n\n' +
      'The analysis also shows only a small gain (+2.3) on broad summary questions [p. 7].',
  },
]

export const MOCK_FALLBACK = {
  pages: [1, 5],
  answer:
    'Based on the retrieved passages, the paper argues that **hybrid retrieval** (BM25 + dense) is a cheap and ' +
    'robust default for question answering over long papers [p. 1]. Its headline result is a **+7.4** point accuracy ' +
    'gain with **38%** less context [p. 5].\n\n> This is a mock answer. Start the backend to chat with a real LLM.',
}

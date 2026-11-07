// Builds a small, valid multi-page PDF in the browser so the mock has something to show.

function esc(s: string) {
  return s.replace(/[\\()]/g, (c) => '\\' + c)
}

export interface SamplePage {
  heading: string
  lines: string[]
}

export function buildSamplePdf(title: string, pages: SamplePage[]): Blob {
  const objects: string[] = []
  const add = (body: string) => {
    objects.push(body)
    return objects.length
  }
  const catalogId = add('') // filled in once the page ids are known
  const pagesId = add('')
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>')
  const boldId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold >>')

  const pageIds: number[] = []
  pages.forEach((p, i) => {
    const ops: string[] = []
    let y = 730
    if (i === 0) {
      ops.push(`BT /F2 17 Tf 72 ${y} Td (${esc(title)}) Tj ET`)
      y -= 44
    }
    ops.push('BT', `/F2 14 Tf 72 ${y} Td (${esc(p.heading)}) Tj`, '/F1 11 Tf 0 -26 Td 16 TL')
    for (const line of p.lines) ops.push(`(${esc(line)}) Tj T*`)
    ops.push('ET', `BT /F1 9 Tf 300 40 Td (${i + 1}) Tj ET`)
    const stream = ops.join('\n')
    const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] ` +
          `/Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldId} 0 R >> >> /Contents ${contentId} 0 R >>`,
      ),
    )
  })
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`
  objects[pagesId - 1] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`

  // Content is ASCII, so string length equals byte offset.
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new Blob([out], { type: 'application/pdf' })
}

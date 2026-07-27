import { Fragment, type ReactNode } from 'react'

export interface MarkdownHeading {
  id: string
  level: number
  text: string
}

function visibleLines(source: string): string[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  if (lines[0]?.trim() !== '---') return lines
  const end = lines.slice(1).findIndex((line) => line.trim() === '---')
  return end === -1 ? lines : lines.slice(end + 2)
}

function slug(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-|-$/g, '') || 'section'
}

function headingMap(lines: string[]): Map<number, MarkdownHeading> {
  const headings = new Map<number, MarkdownHeading>()
  const counts = new Map<string, number>()
  lines.forEach((line, index) => {
    const match = line.match(/^(#{1,4})\s+(.+?)\s*#*$/)
    if (!match) return
    const text = match[2].trim()
    const base = slug(text)
    const count = (counts.get(base) ?? 0) + 1
    counts.set(base, count)
    headings.set(index, { id: count === 1 ? base : `${base}-${count}`, level: match[1].length, text })
  })
  return headings
}

export function markdownHeadings(source: string): MarkdownHeading[] {
  return [...headingMap(visibleLines(source)).values()]
}

function inline(value: string, keyPrefix: string): ReactNode[] {
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\([^)]+\))/g
  const nodes: ReactNode[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(value))) {
    if (match.index > cursor) nodes.push(value.slice(cursor, match.index))
    const token = match[0]
    const key = `${keyPrefix}-${match.index}`
    if (token.startsWith('`')) {
      nodes.push(<code className="markdown-inline-code" key={key}>{token.slice(1, -1)}</code>)
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('*')) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>)
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      nodes.push(<span className="markdown-link" title={link?.[2]} key={key}>{link?.[1]}</span>)
    }
    cursor = match.index + token.length
  }
  if (cursor < value.length) nodes.push(value.slice(cursor))
  return nodes
}

function startsBlock(line: string): boolean {
  return !line.trim()
    || /^#{1,4}\s+/.test(line)
    || /^```/.test(line.trim())
    || /^>\s?/.test(line)
    || /^\s*(?:[-+*]|\d+\.)\s+/.test(line)
    || /^-{3,}$/.test(line.trim())
}

export function MarkdownDocument({ source }: { source: string }) {
  const lines = visibleLines(source)
  const headings = headingMap(lines)
  const blocks: ReactNode[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }

    if (line.trim().startsWith('```')) {
      const language = line.trim().slice(3).trim()
      const code: string[] = []
      index += 1
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        code.push(lines[index])
        index += 1
      }
      index += 1
      blocks.push(
        <pre className="markdown-code-block" data-language={language || undefined} key={`code-${index}`}>
          <code>{code.join('\n')}</code>
        </pre>,
      )
      continue
    }

    const heading = headings.get(index)
    if (heading) {
      const content = inline(heading.text, `heading-${index}`)
      const props = { id: heading.id, key: `heading-${index}` }
      blocks.push(
        heading.level === 1 ? <h1 {...props}>{content}</h1>
          : heading.level === 2 ? <h2 {...props}>{content}</h2>
            : heading.level === 3 ? <h3 {...props}>{content}</h3>
              : <h4 {...props}>{content}</h4>,
      )
      index += 1
      continue
    }

    if (/^-{3,}$/.test(line.trim())) {
      blocks.push(<hr key={`rule-${index}`} />)
      index += 1
      continue
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ''))
        index += 1
      }
      blocks.push(<blockquote key={`quote-${index}`}>{inline(quote.join(' '), `quote-${index}`)}</blockquote>)
      continue
    }

    const listMatch = line.match(/^\s*((?:[-+*])|(?:\d+\.))\s+(.+)$/)
    if (listMatch) {
      const ordered = /\d+\./.test(listMatch[1])
      const items: string[] = []
      while (index < lines.length) {
        const item = lines[index].match(/^\s*((?:[-+*])|(?:\d+\.))\s+(.+)$/)
        if (!item || /\d+\./.test(item[1]) !== ordered) break
        items.push(item[2])
        index += 1
      }
      const listItems = items.map((item, itemIndex) => (
        <li key={`${index}-${itemIndex}`}>{inline(item, `item-${index}-${itemIndex}`)}</li>
      ))
      blocks.push(ordered
        ? <ol key={`list-${index}`}>{listItems}</ol>
        : <ul key={`list-${index}`}>{listItems}</ul>)
      continue
    }

    const paragraph = [line.trim()]
    index += 1
    while (index < lines.length && !startsBlock(lines[index])) {
      paragraph.push(lines[index].trim())
      index += 1
    }
    blocks.push(
      <p key={`paragraph-${index}`}>
        {inline(paragraph.join(' '), `paragraph-${index}`).map((node, nodeIndex) => (
          <Fragment key={`${index}-${nodeIndex}`}>{node}</Fragment>
        ))}
      </p>,
    )
  }

  return <article className="markdown-document">{blocks}</article>
}

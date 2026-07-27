import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownDocument, markdownHeadings } from './markdown'

describe('MarkdownDocument', () => {
  it('renders readable blocks while React escapes embedded HTML', () => {
    const source = [
      '---',
      'name: review-code',
      '---',
      '# Review code',
      '',
      'Use **evidence** and `tests`.',
      '',
      '- Check callers',
      '- <script>alert("no")</script>',
      '',
      '```sh',
      'yarn test',
      '```',
    ].join('\n')

    const html = renderToStaticMarkup(<MarkdownDocument source={source} />)

    expect(markdownHeadings(source)).toEqual([{ id: 'review-code', level: 1, text: 'Review code' }])
    expect(html).toContain('<h1 id="review-code">Review code</h1>')
    expect(html).toContain('<strong>evidence</strong>')
    expect(html).toContain('&lt;script&gt;alert(&quot;no&quot;)&lt;/script&gt;')
    expect(html).toContain('<code>yarn test</code>')
  })
})

import { describe, expect, it } from 'vitest'
import { parseHelpPath } from '@/lib/help/helpRoute'

describe('parseHelpPath', () => {
  it('maps the help paths and ignores everything else', () => {
    expect(parseHelpPath('/help')).toEqual({ kind: 'index' })
    expect(parseHelpPath('/help/')).toEqual({ kind: 'index' })
    expect(parseHelpPath('/help/receive-a-delivery')).toEqual({ kind: 'article', slug: 'receive-a-delivery' })
    expect(parseHelpPath('/help/receive-a-delivery/')).toEqual({ kind: 'article', slug: 'receive-a-delivery' })
    expect(parseHelpPath('/help/print')).toEqual({ kind: 'print' })

    expect(parseHelpPath('/')).toBeNull()
    expect(parseHelpPath('/helpdesk')).toBeNull()
    expect(parseHelpPath('/docs/overview.md')).toBeNull()
    expect(parseHelpPath('/help/a/b')).toBeNull()
    expect(parseHelpPath('/help/Not_A_Slug')).toBeNull()
  })
})

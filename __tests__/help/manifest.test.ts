import { describe, expect, it } from 'vitest'
import { HELP_ARTICLES } from '@/components/help/manifest'
import { ARTICLE_BODIES } from '@/components/help/articles'

describe('help manifest', () => {
  it('holds the six Phase 1 articles, each with a body', () => {
    const slugs = HELP_ARTICLES.map((a) => a.slug)
    expect(slugs).toEqual([
      'warehouse-journey',
      'receive-a-delivery',
      'put-a-pallet-away',
      'check-stock-location',
      'assign-putaway',
      'if-something-goes-wrong',
    ])
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const slug of slugs) expect(typeof ARTICLE_BODIES[slug]).toBe('function')
    expect(Object.keys(ARTICLE_BODIES).sort()).toEqual([...slugs].sort())
    expect(HELP_ARTICLES.find((a) => a.slug === 'assign-putaway')?.audiences).toEqual(['supervisor'])
  })
})

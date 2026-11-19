import React from 'react'
import { afterEach, describe, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import HelpCentre from '../../components/help/HelpCentre'
import { expectNoA11yViolations } from '../support/axe'

afterEach(cleanup)

describe('help centre a11y', () => {
  it('index and an article have no axe violations', async () => {
    const index = render(<HelpCentre route={{ kind: 'index' }} audience={null} />)
    await expectNoA11yViolations(index.container)
    cleanup()
    const article = render(<HelpCentre route={{ kind: 'article', slug: 'receive-a-delivery' }} audience="floor" />)
    await expectNoA11yViolations(article.container)
  })
})

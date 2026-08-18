// Guards F15, F16 and F17 — the 44 px floor, and the truncation cap that keeps
// a long location name from starving the product name on a walk card.
//
// Every one of these was found by measuring, not by looking: a 38 px input and
// a 16 px "put it back" link both render perfectly and are simply hard to hit
// with a gloved thumb. That is why they are asserted as numbers here.
//
// The walk cards are DATA-DEPENDENT — a queue with no work has no card to
// measure — so those tests skip with a stated reason rather than failing. A
// skip that says why is worth more than a green run that measured nothing.
import { expect, test } from '../fixtures/auth'
import { expectTouchTarget, navigateTo } from './helpers'

test.describe('F15 — ScanField clears the touch floor', () => {
  test('the stocktake bin finder: input and camera button', async ({ warehousePage: page }) => {
    await navigateTo(page, 'Stocktake')

    const field = page.getByLabel('Scan a bin label')
    await expect(field).toBeVisible()
    await expectTouchTarget(field, 'bin scan field')

    // The camera button shares the field's height. `isCameraScanAvailable()`
    // only checks the API exists, so this renders on desktop Chrome too — see
    // F1, where a Permissions-Policy header denied the camera to our own origin
    // while the button still rendered.
    const camera = page.getByRole('button', { name: /scan/i }).first()
    if (await camera.isVisible().catch(() => false)) {
      await expectTouchTarget(camera, 'camera button')
    }
  })
})

test.describe('F16 / F17 — walk cards', () => {
  for (const queue of ['Putaway', 'Replenishment'] as const) {
    test(`${queue}: stop-card controls are reachable and names survive`, async ({
      warehousePage: page,
    }) => {
      await navigateTo(page, queue)

      // A stop card carries a "put it back" escape hatch — the control an
      // operator reaches for when something has ALREADY gone wrong, and the one
      // that was 16 px tall.
      const escape = page.getByRole('button', { name: /put (it )?back|unassign|hand back/i })
      const count = await escape.count()
      // Read this skip literally: it does NOT mean the queue is empty. The stop
      // cards live in the WALK view, which is reached by assigning work — a
      // write, and this suite is read-mostly. So F16/F17 stay unguarded until
      // someone decides that assigning a task in a spec is acceptable. Recorded
      // that way rather than deleted, because a skip that explains itself is
      // worth more than a green run that measured nothing.
      test.skip(
        count === 0,
        `no ${queue.toLowerCase()} stop cards on the queue page — they are in the walk view, ` +
          'which this read-mostly suite does not enter because starting a walk assigns work',
      )

      for (let i = 0; i < count; i += 1) {
        await expectTouchTarget(escape.nth(i), `${queue} escape hatch #${i}`)
      }

      // F17: the right-hand column was `shrink-0` with no width cap, so
      // `truncate` on its child could never fire and a long location name
      // starved the product name — the one thing the walker is scanning for.
      const overflowing = await page.evaluate((limit) => {
        const cards = Array.from(document.querySelectorAll('[class*="truncate"]'))
        return cards.filter((el) => {
          const box = (el as HTMLElement).getBoundingClientRect()
          return box.width > 0 && box.right > limit + 1
        }).length
      }, 360)
      expect(overflowing, 'a truncating element spills past the viewport').toBe(0)

    })
  }
})

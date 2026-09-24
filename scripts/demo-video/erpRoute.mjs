// scripts/demo-video/erpRoute.mjs
//
// Serves erp-mock.html for the ERP_MOCK_ORIGIN URL via page.route(), so the
// storyboard can page.goto() what looks like a completely different app
// without a second dev server. The page data (which orders are "ready to
// import") is injected as an inline <script> before serving — erp-mock.html
// itself is a pure renderer of window.__ERP_DATA__.

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ERP_MOCK_ORIGIN, buildErpOrders } from './config.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATE_PATH = join(HERE, 'erp-mock.html')

/**
 * @param {import('@playwright/test').BrowserContext} context
 */
export async function registerErpMockRoute(context) {
  const template = await readFile(TEMPLATE_PATH, 'utf8')
  const orders = buildErpOrders()
  const dataScript = `<script>window.__ERP_DATA__ = ${JSON.stringify({ orders })};</script>`
  const html = template.replace('</head>', `${dataScript}\n</head>`)

  await context.route(`${ERP_MOCK_ORIGIN}/**`, route => {
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
  })
}

// scripts/demo-video/overlay.js
//
// Browser-side annotation layer for the guided demo-video cut. Injected via
// page.addInitScript({ path: … }), so it re-runs fresh on every navigation
// (login page, the app, the mock ERP page) and needs no bundler — plain
// vanilla JS, no imports.
//
// Exposes window.__demo = { placeCursor, moveCursor, clickPulse, callout,
// banner, clearCallout, clearBanner }. Every element this file creates is
// `pointer-events:none` and sits in its own div appended to <html> (not
// <body>, so it survives whatever the app's own root does) at the maximum
// z-index — it must never be clickable and never sit under a modal.
;(function () {
  var ROOT_ID = '__demo_overlay_root'
  var CURSOR_ID = '__demo_cursor'
  var BANNER_ID = '__demo_banner'
  var Z = 2147483647
  var BLUE = '#2988de'
  var INK = '#1c2333'
  var FONT = '"Plus Jakarta Sans","DM Sans",system-ui,-apple-system,sans-serif'

  function ensureRoot() {
    var root = document.getElementById(ROOT_ID)
    if (root) return root
    var host = document.body || document.documentElement
    root = document.createElement('div')
    root.id = ROOT_ID
    root.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:' + Z + ';font-family:' + FONT + ';'
    host.appendChild(root)
    return root
  }

  function whenReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true })
    } else {
      fn()
    }
  }

  function ensureCursor() {
    var root = ensureRoot()
    var cur = document.getElementById(CURSOR_ID)
    if (cur) return cur
    cur = document.createElement('div')
    cur.id = CURSOR_ID
    cur.style.cssText = [
      'position:fixed',
      'top:0',
      'left:0',
      'width:20px',
      'height:20px',
      'margin:-10px 0 0 -10px',
      'border-radius:50%',
      'background:radial-gradient(circle at 35% 30%, #ffffff, ' + BLUE + ' 55%, #164a80 100%)',
      'box-shadow:0 2px 10px rgba(0,0,0,0.4), 0 0 0 3px rgba(41,136,222,0.22)',
      'opacity:0',
      'pointer-events:none',
      'z-index:' + Z,
    ].join(';')
    root.appendChild(cur)
    return cur
  }

  /** Instantly place the cursor and fade it in — used once at the start of
   *  a run, before the first smooth move. */
  function placeCursor(x, y) {
    var cur = ensureCursor()
    cur.style.transition = 'none'
    cur.style.left = x + 'px'
    cur.style.top = y + 'px'
    // Force layout so the browser applies the position before we animate
    // opacity, or the fade-in would race the placement.
    void cur.offsetWidth
    cur.style.transition = 'opacity 200ms ease'
    cur.style.opacity = '1'
  }

  /** Smoothly animate the cursor to (x, y) over `duration` ms. Resolves once
   *  the transition has had time to finish. */
  function moveCursor(x, y, duration) {
    return new Promise(function (resolve) {
      var cur = ensureCursor()
      if (cur.style.opacity !== '1') {
        placeCursor(x, y)
        resolve()
        return
      }
      var ms = duration || 600
      cur.style.transition = 'left ' + ms + 'ms cubic-bezier(.4,0,.2,1), top ' + ms + 'ms cubic-bezier(.4,0,.2,1)'
      requestAnimationFrame(function () {
        cur.style.left = x + 'px'
        cur.style.top = y + 'px'
        setTimeout(resolve, ms + 30)
      })
    })
  }

  /** A brief ripple at the cursor's current position, for the moment of a click. */
  function clickPulse() {
    var root = ensureRoot()
    var cur = document.getElementById(CURSOR_ID)
    if (!cur) return
    var x = parseFloat(cur.style.left) || 0
    var y = parseFloat(cur.style.top) || 0
    var ring = document.createElement('div')
    ring.style.cssText = [
      'position:fixed',
      'left:' + x + 'px',
      'top:' + y + 'px',
      'width:8px',
      'height:8px',
      'margin:-4px 0 0 -4px',
      'border-radius:50%',
      'border:2px solid ' + BLUE,
      'opacity:0.9',
      'pointer-events:none',
      'z-index:' + Z,
      'transition:transform 420ms ease-out, opacity 420ms ease-out',
    ].join(';')
    root.appendChild(ring)
    requestAnimationFrame(function () {
      ring.style.transform = 'scale(4)'
      ring.style.opacity = '0'
    })
    setTimeout(function () {
      ring.remove()
    }, 450)
  }

  var svgNS = 'http://www.w3.org/2000/svg'
  var activeCallout = null

  function clearCallout() {
    if (!activeCallout) return
    var nodes = activeCallout
    activeCallout = null
    nodes.forEach(function (n) {
      if (n && n.remove) n.remove()
    })
  }

  /**
   * Draw a callout box + arrow + highlight ring pointing at `target` (a CSS
   * selector). Resolves after it has faded back out, so callers can simply
   * `await` it for pacing. Resolves immediately (no-op) if the selector
   * doesn't match anything on screen — a missing target should never hang
   * the recording.
   */
  function callout(opts) {
    return new Promise(function (resolve) {
      var el = typeof opts.target === 'string' ? document.querySelector(opts.target) : opts.target
      if (!el) {
        resolve()
        return
      }
      clearCallout()
      var root = ensureRoot()
      var rect = el.getBoundingClientRect()
      var side = opts.side || 'top'
      var vw = window.innerWidth
      var vh = window.innerHeight
      var bw = 320
      var gap = 20

      var box = document.createElement('div')
      box.style.cssText = [
        'position:fixed',
        'width:' + bw + 'px',
        'background:' + INK,
        'color:#ffffff',
        'border:1px solid rgba(41,136,222,0.55)',
        'border-radius:12px',
        'box-shadow:0 14px 34px rgba(0,0,0,0.45)',
        'padding:12px 14px',
        'font-size:15px',
        'line-height:1.4',
        'opacity:0',
        'transform:translateY(6px)',
        'transition:opacity 240ms ease,transform 240ms ease',
        'pointer-events:none',
        'z-index:' + Z,
      ].join(';')
      if (opts.title) {
        var t = document.createElement('div')
        t.textContent = opts.title
        t.style.cssText =
          'font-weight:700;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:#8ec3f2;margin-bottom:4px;'
        box.appendChild(t)
      }
      var body = document.createElement('div')
      body.textContent = opts.text || ''
      box.appendChild(body)

      // Provisional position, refined once we know the box's real height.
      var bx = rect.left + rect.width / 2 - bw / 2
      var by = side === 'bottom' ? rect.bottom + gap : rect.top - gap - 80
      if (side === 'left') {
        bx = rect.left - gap - bw
        by = rect.top + rect.height / 2 - 50
      } else if (side === 'right') {
        bx = rect.right + gap
        by = rect.top + rect.height / 2 - 50
      }
      bx = Math.max(16, Math.min(vw - bw - 16, bx))
      by = Math.max(16, Math.min(vh - 140, by))
      box.style.left = bx + 'px'
      box.style.top = by + 'px'
      root.appendChild(box)

      var boxRect = box.getBoundingClientRect()
      // Re-clamp now the real height is known (top-side callouts anchor by
      // their bottom edge, so height matters).
      if (side === 'top') {
        by = Math.max(16, rect.top - gap - boxRect.height)
        box.style.top = by + 'px'
      }

      var svg = document.createElementNS(svgNS, 'svg')
      svg.setAttribute('width', String(vw))
      svg.setAttribute('height', String(vh))
      svg.style.cssText =
        'position:fixed;top:0;left:0;pointer-events:none;z-index:' + (Z - 1) + ';opacity:0;transition:opacity 240ms ease;'
      var defs = document.createElementNS(svgNS, 'defs')
      var marker = document.createElementNS(svgNS, 'marker')
      var markerId = '__demo_arrowhead'
      marker.setAttribute('id', markerId)
      marker.setAttribute('markerWidth', '9')
      marker.setAttribute('markerHeight', '9')
      marker.setAttribute('refX', '6')
      marker.setAttribute('refY', '4.5')
      marker.setAttribute('orient', 'auto')
      var mpath = document.createElementNS(svgNS, 'path')
      mpath.setAttribute('d', 'M0,0 L9,4.5 L0,9 Z')
      mpath.setAttribute('fill', BLUE)
      marker.appendChild(mpath)
      defs.appendChild(marker)
      svg.appendChild(defs)

      var anchorX =
        side === 'left' ? bx + bw : side === 'right' ? bx : bx + bw / 2
      var anchorY =
        side === 'top' ? by + boxRect.height : side === 'bottom' ? by : by + boxRect.height / 2
      var targetX = rect.left + rect.width / 2
      var targetY = rect.top + rect.height / 2
      var line = document.createElementNS(svgNS, 'line')
      line.setAttribute('x1', String(anchorX))
      line.setAttribute('y1', String(anchorY))
      line.setAttribute('x2', String(targetX))
      line.setAttribute('y2', String(targetY))
      line.setAttribute('stroke', BLUE)
      line.setAttribute('stroke-width', '2.5')
      line.setAttribute('marker-end', 'url(#' + markerId + ')')
      svg.appendChild(line)
      root.appendChild(svg)

      var ring = document.createElement('div')
      ring.style.cssText = [
        'position:fixed',
        'left:' + (rect.left - 4) + 'px',
        'top:' + (rect.top - 4) + 'px',
        'width:' + (rect.width + 8) + 'px',
        'height:' + (rect.height + 8) + 'px',
        'border:2px solid ' + BLUE,
        'border-radius:10px',
        'box-shadow:0 0 0 4px rgba(41,136,222,0.16)',
        'opacity:0',
        'transition:opacity 240ms ease',
        'pointer-events:none',
        'z-index:' + (Z - 1),
      ].join(';')
      root.appendChild(ring)

      activeCallout = [box, svg, ring]

      requestAnimationFrame(function () {
        box.style.opacity = '1'
        box.style.transform = 'translateY(0)'
        svg.style.opacity = '1'
        ring.style.opacity = '1'
      })

      var ttl = typeof opts.ms === 'number' ? opts.ms : 3200
      setTimeout(function () {
        // If a newer callout() call already cleared this one, there is
        // nothing left to fade — clearCallout() already removed the nodes.
        if (!box.isConnected) {
          resolve()
          return
        }
        box.style.opacity = '0'
        box.style.transform = 'translateY(6px)'
        svg.style.opacity = '0'
        ring.style.opacity = '0'
        setTimeout(function () {
          box.remove()
          svg.remove()
          ring.remove()
          if (activeCallout && activeCallout[0] === box) activeCallout = null
          resolve()
        }, 260)
      }, ttl)
    })
  }

  function banner(text) {
    var root = ensureRoot()
    var el = document.getElementById(BANNER_ID)
    if (!el) {
      el = document.createElement('div')
      el.id = BANNER_ID
      el.style.cssText = [
        'position:fixed',
        'left:24px',
        'bottom:24px',
        'display:flex',
        'align-items:center',
        'gap:8px',
        'background:' + INK,
        'color:#ffffff',
        'padding:10px 16px',
        'border-radius:999px',
        'font-size:14px',
        'font-weight:600',
        'letter-spacing:.01em',
        'box-shadow:0 10px 26px rgba(0,0,0,0.4)',
        'border:1px solid rgba(41,136,222,0.5)',
        'opacity:0',
        'transform:translateY(8px)',
        'transition:opacity 260ms ease,transform 260ms ease',
        'pointer-events:none',
        'z-index:' + Z,
      ].join(';')
      var dot = document.createElement('span')
      dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:' + BLUE + ';flex:none;'
      var span = document.createElement('span')
      span.id = BANNER_ID + '_text'
      el.appendChild(dot)
      el.appendChild(span)
      root.appendChild(el)
    }
    document.getElementById(BANNER_ID + '_text').textContent = text
    requestAnimationFrame(function () {
      el.style.opacity = '1'
      el.style.transform = 'translateY(0)'
    })
  }

  function clearBanner() {
    var el = document.getElementById(BANNER_ID)
    if (!el) return
    el.style.opacity = '0'
    el.style.transform = 'translateY(8px)'
    setTimeout(function () {
      el.remove()
    }, 260)
  }

  whenReady(ensureRoot)

  window.__demo = {
    placeCursor: placeCursor,
    moveCursor: moveCursor,
    clickPulse: clickPulse,
    callout: callout,
    clearCallout: clearCallout,
    banner: banner,
    clearBanner: clearBanner,
  }
})()

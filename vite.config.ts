import path from 'path';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { visualizer } from 'rollup-plugin-visualizer';

import { TARGETS, ALL_MODULES, isProvisioned } from './config/environments.mjs';
import { SITE_DOCS } from './site/manifest.mjs';

// ── NEXORDER_ENV IS RESOLVED ONCE, AND A WRONG VALUE IS FATAL ───────────────
//
// Unset falls back to `dev`, which is what makes a bare `vite build` and a
// local dev server work. A value that is SET but names no target does NOT fall
// back: it throws.
//
// That distinction became load-bearing on 2026-08-20, when targets stopped
// sharing a module set. NEXORDER_ENV lives in the Vercel project's build
// environment and nothing in the repo asserts it, so a typo used to mean a
// tenant silently built with `dev`'s modules — which is every module, i.e. the
// client is served the surfaces they did not buy, with no error anywhere. A
// missing variable is a mistake; a misspelled one is the same mistake wearing
// a disguise, and only the second is detectable here.
function resolveBuildTarget() {
    const raw = process.env.NEXORDER_ENV?.trim();
    if (!raw) return TARGETS.dev;
    const target = TARGETS[raw];
    if (!target) {
        throw new Error(
            `NEXORDER_ENV="${raw}" names no target. Valid values: ${Object.keys(TARGETS).join(', ')}. ` +
                `Refusing to fall back to 'dev' — that would build this deployment with dev's module set.`,
        );
    }
    return target;
}

// Dev-server fallback for the /storage image proxy (see `server.proxy` below).
// Resolved from NEXORDER_ENV the same way vercel.ts does, so one variable
// describes the target everywhere. Never a typed ref — the registry owns those.
const proxyTarget = resolveBuildTarget();

// ── MODULE FLAGS: ONE BOOLEAN PER MODULE, NEVER AN ARRAY ────────────────────
//
// Layer A of MULTI-TENANT-ARCHITECTURE.md §3. `__MODULE_SALES_ORDERS__` and
// friends are substituted as the literals `true`/`false`, so `if (!X) return`
// folds away and Rollup drops the whole branch — including any `import()` only
// that branch reaches. THAT is what makes a disabled module absent from the
// tenant's bundle rather than merely hidden behind a check.
//
// An array would defeat it completely: `MODULES.includes('warehouse')` is a
// runtime call on a runtime value, nothing folds, and every byte of every
// disabled module ships to a tenant who did not buy it — reachable by anyone
// who opens devtools. The array lives in the registry, where it is config; it
// becomes constants here, at the only point that can act on it.
//
// Same NEXORDER_ENV that already picks the storage proxy and the CSP, so one
// variable per Vercel project decides everything about which deployment this
// build is. `lib/modules.ts` is the only thing that should read these.
const moduleTarget = resolveBuildTarget();
const moduleDefines = Object.fromEntries(
    ALL_MODULES.map((slug: string) => [
        `__MODULE_${slug.toUpperCase()}__`,
        JSON.stringify(moduleTarget.modules.includes(slug)),
    ]),
);
// ONE BOOLEAN, DERIVED, NOT A SECOND SWITCH.
//
// `kind` already means exactly this: the registry documents 'demo' as NexGen's
// own deployment where fixtures are allowed and demo logins are shown, and
// 'tenant' as a paying client's where none of that is ever true. Reading it
// here makes "does this build carry demo credentials" a property of the target
// registry -- reviewable in a diff -- instead of a value typed into a Vercel
// dashboard that nothing in this repo can see.
//
// It replaces VITE_SHOW_DEMO_LOGINS, which was read as `!== 'false'`: an
// opt-OUT, so a tenant build shipped seven working logins and their shared
// password unless somebody remembered to type "false" into a web form. Nobody
// did, and nexorder.com.au served them to a paying client. Inverting it to
// opt-IN would only have moved the silence: the demo would then lose its roster
// with no error anywhere, and you would hear about it from a prospect.
//
// scripts/check-demo-surface.mjs asserts the fold on the built artifact, in
// both directions, for every target.
const isDemoHost = moduleTarget.kind === 'demo';

// Where "Book a demo" points, or null. NULL on a tenant by registry, and null
// anywhere no scheduler is configured -- the button does not render without a
// URL, so an unset value ships nothing rather than a dead link.
const bookDemoUrl =
    (moduleTarget as { publicSite?: { bookDemoUrl?: string | null } }).publicSite?.bookDemoUrl ?? null;

const storageProxyTarget = isProvisioned(proxyTarget)
    ? proxyTarget.supabaseUrl
    : TARGETS.dev.supabaseUrl;

// Bundle analysis is opt-in via ANALYZE=1 (`npm run build:analyze`) so that CI
// and Vercel builds stay byte-identical to what they produced before the
// analyzer was added. rollup-plugin-visualizer is a devDependency and must
// never appear in the default plugin list.
const ANALYZE = process.env.ANALYZE === '1';

// Resolve the commit sha for the build-version embed. Vercel CLI deploys build
// remotely without .git, so deploy.mjs passes GIT_COMMIT_SHA explicitly;
// VERCEL_GIT_COMMIT_SHA covers git-integration builds; local dev falls back to
// `git rev-parse` and finally 'dev'.
/**
 * Per-target <head>: title, description, canonical, manifest, icons and the
 * Open Graph / Twitter card.
 *
 * `transformIndexHtml`, not `emitFile`. This is not a new file; it is an edit to
 * one that Vite's own `vite:build-html` plugin already owns, and reaching into
 * `bundle['index.html'].source` to string-replace would depend on undocumented
 * plugin ordering against it.
 *
 * The `tags` ARRAY form, never the string form. Returning a string reserialises
 * <head>, which here holds the inline <style> shipping the scrollbar rules under
 * `style-src 'unsafe-inline'`, and two font preloads whose `crossorigin` is
 * load-bearing (without it each font is fetched twice). Appending tags touches
 * none of it.
 *
 * Everything injected is <meta> or <link>, so `script-src 'self'` is unaffected
 * and the CSP needs no change.
 */
function headMetaPlugin(target: (typeof TARGETS)[keyof typeof TARGETS]): Plugin {
    const site = (target as { publicSite?: Record<string, string | null> }).publicSite;
    const origin = String((target as { appOrigin?: string }).appOrigin ?? '').replace(/\/$/, '');

    return {
        name: 'nexorder-head-meta',
        transformIndexHtml: {
            // 'pre' so these land ahead of Vite's own script/link injection and
            // the built <head> stays readable.
            order: 'pre',
            handler() {
                if (!site) return [];
                const abs = (p: string) => `${origin}${p}`;
                const meta = (attrs: Record<string, string>) =>
                    ({ tag: 'meta', attrs, injectTo: 'head' as const });

                return [
                    { tag: 'title', children: String(site.title), injectTo: 'head' as const },
                    meta({ name: 'description', content: String(site.description) }),
                    meta({ name: 'theme-color', content: '#0a2e52' }),
                    { tag: 'link', attrs: { rel: 'canonical', href: `${origin}/` }, injectTo: 'head' as const },
                    { tag: 'link', attrs: { rel: 'manifest', href: '/manifest.webmanifest' }, injectTo: 'head' as const },
                    { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }, injectTo: 'head' as const },
                    meta({ property: 'og:type', content: 'website' }),
                    meta({ property: 'og:site_name', content: 'Nex Order' }),
                    meta({ property: 'og:url', content: `${origin}/` }),
                    meta({ property: 'og:title', content: String(site.title) }),
                    meta({ property: 'og:description', content: String(site.description) }),
                    meta({ property: 'og:image', content: abs(String(site.ogImage)) }),
                    meta({ property: 'og:image:width', content: '1200' }),
                    meta({ property: 'og:image:height', content: '630' }),
                    meta({ name: 'twitter:card', content: 'summary_large_image' }),
                    meta({ name: 'twitter:title', content: String(site.title) }),
                    meta({ name: 'twitter:description', content: String(site.description) }),
                    meta({ name: 'twitter:image', content: abs(String(site.ogImage)) }),
                ];
            },
        },
    };
}

/**
 * /llms.txt, /llms-full.txt and /docs/*.md, emitted per target.
 *
 * They cannot live in `public/`: that directory is copied byte-for-byte to every
 * deployment, and these must carry absolute URLs naming their own host plus a
 * demo-only call to action that must never appear on a client's deployment.
 *
 * The index is GENERATED from site/manifest.mjs, so a doc cannot ship unlisted
 * and the index cannot name a page that does not exist.
 *
 * Two substitutions keep the sources readable as ordinary Markdown in an editor:
 * `{{ORIGIN}}` / `{{BOOK_DEMO_URL}}` tokens, and `<!-- demo:start -->` blocks
 * stripped for a tenant. HTML comments are legal Markdown and render as nothing.
 */
function sitePlugin(target: (typeof TARGETS)[keyof typeof TARGETS]): Plugin {
    const origin = String((target as { appOrigin?: string }).appOrigin ?? '').replace(/\/$/, '');
    const site = (target as { publicSite?: Record<string, string | null> }).publicSite;
    const isDemo = (target as { kind?: string }).kind === 'demo';
    const bookDemoUrl = site?.bookDemoUrl ?? null;

    const render = (raw: string) => {
        let out = raw;
        // A tenant gets none of the demo-only prose. Stripped first, so a token
        // inside a removed block never has to resolve.
        if (!isDemo) out = out.replace(/<!--\s*demo:start\s*-->[\s\S]*?<!--\s*demo:end\s*-->\s*/g, '');
        // With no scheduler configured there is no link to offer, so the line
        // carrying it goes rather than pointing at nothing.
        if (!bookDemoUrl) out = out.replace(/^.*\{\{BOOK_DEMO_URL\}\}.*\r?\n?/gm, '');
        return out
            .replace(/\{\{ORIGIN\}\}/g, origin)
            .replace(/\{\{BOOK_DEMO_URL\}\}/g, bookDemoUrl ?? '')
            .replace(/\n{3,}/g, '\n\n');
    };

    const build = () => {
        const docs = SITE_DOCS.map((d: { slug: string; title: string; summary: string }) => ({
            slug: d.slug,
            title: d.title,
            summary: d.summary,
            body: render(readFileSync(path.resolve(__dirname, 'site', `${d.slug}.md`), 'utf8')),
        }));

        const index =
            '# Nex Order\n\n' +
            `> ${site?.description ?? 'Order management for wholesale distribution.'}\n\n` +
            'Nex Order is order-management software for wholesale distribution, made by\n' +
            'NexGen Innovations in Sydney. It covers the path from an inbound purchase\n' +
            'order to the loading dock: order capture, per-customer pricing, warehouse\n' +
            'receiving, putaway, directed picking, replenishment, stocktake and dispatch.\n\n' +
            'It is deployed separately for each business that uses it, and is reached by\n' +
            'invitation rather than by search.\n\n' +
            '## Docs\n\n' +
            docs.map((d) => `- [${d.title}](${origin}/docs/${d.slug}.md): ${d.summary}`).join('\n') +
            '\n';

        const full = index + '\n---\n\n' + docs.map((d) => d.body.trim()).join('\n\n---\n\n') + '\n';

        return { docs, index, full };
    };

    return {
        name: 'nexorder-site',
        generateBundle() {
            const { docs, index, full } = build();
            this.emitFile({ type: 'asset', fileName: 'llms.txt', source: index });
            this.emitFile({ type: 'asset', fileName: 'llms-full.txt', source: full });
            for (const d of docs) {
                this.emitFile({ type: 'asset', fileName: `docs/${d.slug}.md`, source: d.body });
            }
        },
        // `generateBundle` runs only on `build`, so without this /llms.txt would
        // 404 under `npm run dev` and the first time anyone looked at it would be
        // in production.
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                const url = (req.url ?? '').split('?')[0];
                let built;
                try {
                    built = build();
                } catch {
                    return next();
                }
                const send = (body: string) => {
                    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                    res.end(body);
                };
                if (url === '/llms.txt') return send(built.index);
                if (url === '/llms-full.txt') return send(built.full);
                const doc = built.docs.find((d) => url === `/docs/${d.slug}.md`);
                if (doc) return send(doc.body);
                return next();
            });
        },
    };
}

function resolveCommitSha(): string {
    // NOTE: Vercel populates system env vars as EMPTY STRINGS on CLI deploys
    // (no git metadata), so empty must be treated as absent — `??` alone would
    // let VERCEL_GIT_COMMIT_SHA='' mask the GIT_COMMIT_SHA build-env.
    const fromEnv = [process.env.VERCEL_GIT_COMMIT_SHA, process.env.GIT_COMMIT_SHA]
        .find((v) => typeof v === 'string' && v.trim() !== '');
    if (fromEnv) return fromEnv.trim();
    try {
        return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
            .toString()
            .trim();
    } catch {
        return 'dev';
    }
}

// Emit /version.json alongside the bundle. Vercel serves static files before
// the SPA rewrite, so the deploy-verification loop can poll it cache-free.
function versionJsonPlugin(sha: string, builtAt: string): Plugin {
    return {
        name: 'emit-version-json',
        generateBundle() {
            this.emitFile({
                type: 'asset',
                fileName: 'version.json',
                source: JSON.stringify({ sha, builtAt }),
            });
        },
    };
}

export default defineConfig(() => {
    const sha = resolveCommitSha();
    const builtAt = new Date().toISOString();
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        // Mirror vercel.ts's /storage rewrite so `lib/imageUrl.ts`'s
        // same-origin image paths resolve in dev too. Without it every image
        // 404s once before <OptimizedImage> falls back to the direct Supabase
        // URL — images would still appear, but the console would be full of
        // failures that mean nothing.
        //
        // The build's own VITE_SUPABASE_URL wins over the registry: a dev
        // server started against a different project should proxy to THAT
        // project. The registry entry is the fallback — and it is imported,
        // never typed, because that file is the only place a ref may appear.
        proxy: {
          '/storage': {
            target: process.env.VITE_SUPABASE_URL?.trim() || storageProxyTarget,
            changeOrigin: true,
          },
        },
      },
      plugins: [
        react(),
        tailwindcss(),
        versionJsonPlugin(sha, builtAt),
        headMetaPlugin(moduleTarget),
        sitePlugin(moduleTarget),
        ...(ANALYZE
          ? [visualizer({
              filename: 'dist/stats.html',
              template: 'treemap',
              gzipSize: true,
              brotliSize: true,
              open: false,
            }) as Plugin]
          : []),
      ],
      build: {
        // ── THE BROWSER FLOOR, STATED ONCE ──────────────────────────────────
        //
        // Tailwind v4 needs Chrome 111 / Safari 16.4 / Firefox 128 — it emits
        // `color-mix()`, `@property` and cascade layers unconditionally. Vite's
        // default target is roughly Chrome 107, so the JS floor sat BELOW the
        // CSS floor: an older handheld parsed the bundle, ran the app, and
        // rendered it with no styles at all. That reads as "the app is broken",
        // and on a warehouse device the scanner gets blamed first.
        //
        // Matching the two makes the failure honest rather than silent — but it
        // changes the failure, so it is only half the fix. Below the floor the
        // bundle now fails to PARSE, which is a white screen. `index.html` +
        // `public/browser-check.js` are the other half: a plain-HTML notice,
        // feature-detected, outside Tailwind and outside the module graph.
        // Do not raise this without keeping that check in step.
        target: ['chrome111', 'edge111', 'safari16.4', 'firefox128'],
        // 'hidden' keeps attribution accurate for the treemap without shipping
        // a sourceMappingURL comment to production.
        sourcemap: ANALYZE ? 'hidden' as const : false,
        chunkSizeWarningLimit: 700,
        rollupOptions: {
          output: {
            // Long-lived vendor chunks. This does NOT reduce first-visit
            // bytes — it splits the same JS across more files so an app-only
            // redeploy doesn't invalidate React/Supabase in a returning
            // user's cache.
            //
            // Deliberately NOT listed here:
            //   lucide-react — sideEffects:false and named imports only, so
            //     Rollup already emits per-icon chunks for lazily-reached
            //     icons. Forcing them into one chunk would pull those back
            //     into the eager graph.
            //   recharts / leaflet / @zxing/browser / browser-image-compression
            //     — already correctly split by dynamic import. Naming them
            //     risks promoting them into the initial graph.
            // Matched on the resolved path rather than the object form: the
            // app imports 'react-dom/client', which is a distinct module id
            // that `{'vendor-react': ['react-dom']}` does not catch — it
            // produced a 3.9 kB chunk and left react-dom in the entry.
            // The [\\/] boundaries keep react-leaflet out of vendor-react.
            manualChunks(id: string) {
              if (!id.includes('node_modules')) return;
              if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react';
              if (/[\\/]node_modules[\\/]@supabase[\\/]/.test(id)) return 'vendor-supabase';
              if (/[\\/]node_modules[\\/]@tanstack[\\/]/.test(id)) return 'vendor-query';
            },
          },
        },
      },
      define: {
        __APP_VERSION__: JSON.stringify(sha),
        __BUILD_TIME__: JSON.stringify(builtAt),
        __DEMO_HOST__: JSON.stringify(isDemoHost),
        __BOOK_DEMO_URL__: JSON.stringify(bookDemoUrl),
        ...moduleDefines,
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});

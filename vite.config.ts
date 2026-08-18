import path from 'path';
import { execSync } from 'node:child_process';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { visualizer } from 'rollup-plugin-visualizer';

import { TARGETS, ALL_MODULES, isProvisioned } from './config/environments.mjs';

// Dev-server fallback for the /storage image proxy (see `server.proxy` below).
// Resolved from NEXORDER_ENV the same way vercel.ts does, so one variable
// describes the target everywhere. Never a typed ref — the registry owns those.
const proxyTarget = TARGETS[process.env.NEXORDER_ENV?.trim() ?? ''] ?? TARGETS.dev;

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
const moduleTarget = TARGETS[process.env.NEXORDER_ENV?.trim() ?? ''] ?? TARGETS.dev;
const moduleDefines = Object.fromEntries(
    ALL_MODULES.map((slug: string) => [
        `__MODULE_${slug.toUpperCase()}__`,
        JSON.stringify(moduleTarget.modules.includes(slug)),
    ]),
);
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
        ...moduleDefines,
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});

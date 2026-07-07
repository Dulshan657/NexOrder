import path from 'path';
import { execSync } from 'node:child_process';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

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
      },
      plugins: [react(), tailwindcss(), versionJsonPlugin(sha, builtAt)],
      define: {
        __APP_VERSION__: JSON.stringify(sha),
        __BUILD_TIME__: JSON.stringify(builtAt),
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});

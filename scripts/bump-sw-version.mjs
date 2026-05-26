// ----------------------------------------------------------------------------
// scripts/bump-sw-version.mjs
//
// Stamps a fresh cache-version string into public/sw.js right before every
// `next build`. Without this, returning users would keep loading the old
// cached app shell after a deploy until either:
//   (a) we ship a SW with a new cache name, OR
//   (b) they manually unregister.
//
// The version string is `<package.version>-<short-git-sha>-<timestamp>`.
//   - package.version → the human bump knob
//   - short-git-sha   → guarantees uniqueness even between repeated builds
//                       at the same package version
//   - timestamp       → works as a tiebreaker if git is unavailable (e.g.
//                       a Vercel deploy from a tarball)
//
// Idempotent — re-runs just stamp a new version. Safe to run repeatedly.
// ----------------------------------------------------------------------------

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const swPath = resolve(root, 'public', 'sw.js');
const pkgPath = resolve(root, 'package.json');

function shortGitSha() {
  // Prefer env vars set by hosts so we tag the actual commit being deployed,
  // not whatever's in the local checkout.
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  }
  if (process.env.CF_PAGES_COMMIT_SHA) {
    return process.env.CF_PAGES_COMMIT_SHA.slice(0, 7);
  }
  if (process.env.RAILWAY_GIT_COMMIT_SHA) {
    return process.env.RAILWAY_GIT_COMMIT_SHA.slice(0, 7);
  }
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return 'nogit';
  }
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const version = `${pkg.version}-${shortGitSha()}-${Date.now()}`;
const sw = readFileSync(swPath, 'utf8');

// The SW must include a literal we can find/replace. Update the marker
// below and the corresponding line in public/sw.js together.
const MARKER_RE = /const CACHE = `verge-shell-\$\{self\.location\.host\}-[^`]+`;/;
const REPLACEMENT = `const CACHE = \`verge-shell-\${self.location.host}-${version}\`;`;

if (!MARKER_RE.test(sw)) {
  console.error(
    '[bump-sw-version] Could not find the CACHE = … marker in public/sw.js. ' +
      'The line must match: const CACHE = `verge-shell-${self.location.host}-…`;',
  );
  process.exit(1);
}

const next = sw.replace(MARKER_RE, REPLACEMENT);
if (next === sw) {
  console.log(`[bump-sw-version] no change (already at ${version})`);
} else {
  writeFileSync(swPath, next, 'utf8');
  console.log(`[bump-sw-version] cache version → ${version}`);
}

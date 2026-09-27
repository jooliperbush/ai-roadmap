/**
 * Content-hashed URLs for the files under src/web/public, served at /static/.
 *
 * A reference written as asset('/static/landing.css') renders as /static/landing.css?v=<hash>. The hash changes
 * whenever the bytes do, so a versioned URL can be cached for a year and a deploy still reaches every browser.
 * Every file is hashed once at boot. A file that changes while the process runs, which only happens in local
 * development, is hashed again on its next reference, so an edited stylesheet never hides behind a year-long cache.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PUBLIC_ROOT = fileURLToPath(new URL('./public', import.meta.url));
export const STATIC_PREFIX = '/static/';
/** For a URL that names the current content hash: the bytes behind it can never change. */
export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
/** For an unversioned or out-of-date URL: short enough that a deploy shows within the hour. */
export const SHORT_CACHE = 'public, max-age=3600';

const versions = new Map<string, { mtimeMs: number; size: number; hash: string }>();

function versionOf(file: string): string | null {
  let stat;
  try {
    stat = statSync(file);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  const known = versions.get(file);
  if (known && known.mtimeMs === stat.mtimeMs && known.size === stat.size) return known.hash;
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 10);
  versions.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, hash });
  return hash;
}

/** The current content hash of the file behind a /static/ path, or null when there is no such file. */
export function staticVersion(path: string): string | null {
  if (!path.startsWith(STATIC_PREFIX)) return null;
  let relative: string;
  try {
    relative = decodeURIComponent(path.slice(STATIC_PREFIX.length));
  } catch {
    return null;
  }
  const file = resolve(PUBLIC_ROOT, relative);
  return file.startsWith(PUBLIC_ROOT + sep) ? versionOf(file) : null;
}

/** `/static/landing.css` becomes `/static/landing.css?v=<hash>`. Anything else, including a missing file, is returned as given. */
export function asset(path: string): string {
  const version = path.includes('?') ? null : staticVersion(path);
  return version ? `${path}?v=${version}` : path;
}

export const hasAsset = (path: string): boolean => staticVersion(path) !== null;

/** Immutable only when v= names the hash of the bytes being served, so a stale or foreign v= is never pinned for a year. */
export function staticCacheControl(url: string): string {
  const query = url.indexOf('?');
  if (query === -1) return SHORT_CACHE;
  const version = new URLSearchParams(url.slice(query + 1)).get('v');
  return version !== null && version === staticVersion(url.slice(0, query)) ? IMMUTABLE_CACHE : SHORT_CACHE;
}

function hashAll(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) hashAll(path);
    else if (entry.isFile()) versionOf(path);
  }
}
hashAll(PUBLIC_ROOT);

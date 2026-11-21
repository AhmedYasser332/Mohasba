import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const buildIdPath = path.join(rootDir, '.next', 'BUILD_ID');
const nextStaticDir = path.join(rootDir, '.next', 'static');
const publicIconsDir = path.join(rootDir, 'public', 'icons');
const outputPath = path.join(rootDir, 'public', 'sw-manifest.json');

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function walkFiles(baseDir, urlPrefix) {
  if (!fs.existsSync(baseDir)) {
    return [];
  }
  const results = [];
  const stack = [baseDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (
        entry.name === '.DS_Store' ||
        entry.name === 'Thumbs.db' ||
        entry.name.endsWith('.map')
      ) {
        continue;
      }
      const rel = toPosix(path.relative(baseDir, fullPath));
      results.push(`${urlPrefix}/${rel}`);
    }
  }

  return results;
}

if (!fs.existsSync(buildIdPath)) {
  throw new Error(`Missing ${buildIdPath}. Run "next build" first.`);
}

const buildId = fs.readFileSync(buildIdPath, 'utf8').trim();
if (!buildId) {
  throw new Error('Empty .next/BUILD_ID.');
}

const assets = Array.from(
  new Set([
    '/',
    '/manifest.webmanifest',
    ...walkFiles(nextStaticDir, '/_next/static'),
    ...walkFiles(publicIconsDir, '/icons'),
  ]),
).sort();

const manifest = {
  buildId,
  assets,
};

fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(
  `Generated public/sw-manifest.json (buildId=${buildId}, assets=${assets.length})`,
);

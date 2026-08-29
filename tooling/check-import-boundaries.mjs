import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceImport = /^@cmaster\/([^/]+)(\/.+)$/;
const sourceExtension = /\.(?:ts|tsx|mts|cts|js|mjs)$/;
const importPattern = /(?:from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g;

function workspaceOwner(file, root) {
  const relative = path.relative(root, file);
  const segments = relative.split(path.sep);
  if (segments[0] === 'apps' || segments[0] === 'packages') {
    return `${segments[0]}/${segments[1] ?? ''}`;
  }
  return undefined;
}

export function validateImport(sourceFile, specifier, root) {
  if (workspaceImport.test(specifier)) {
    return `Deep workspace import is forbidden: ${specifier}`;
  }

  if (!specifier.startsWith('.')) return undefined;

  const target = path.resolve(path.dirname(sourceFile), specifier);
  const sourceOwner = workspaceOwner(sourceFile, root);
  const targetOwner = workspaceOwner(target, root);
  if (sourceOwner && targetOwner && sourceOwner !== targetOwner) {
    return `Relative import crosses workspace packages: ${sourceOwner} -> ${targetOwner}`;
  }
  return undefined;
}

async function sourceFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['dist', '.next', 'node_modules'].includes(entry.name)) continue;
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await sourceFiles(location));
    else if (sourceExtension.test(entry.name)) result.push(location);
  }
  return result;
}

export async function checkWorkspaceImports(root) {
  const violations = [];
  for (const area of ['apps', 'packages']) {
    const directory = path.join(root, area);
    let files = [];
    try {
      files = await sourceFiles(directory);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue;
      throw error;
    }
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      for (const match of source.matchAll(importPattern)) {
        const specifier = match[1];
        if (!specifier) continue;
        const message = validateImport(file, specifier, root);
        if (message) violations.push(`${path.relative(root, file)}: ${message}`);
      }
    }
  }
  return violations;
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
  const root = path.resolve(process.argv[2] ?? process.cwd());
  const violations = await checkWorkspaceImports(root);
  if (violations.length > 0) {
    console.error(violations.join('\n'));
    process.exitCode = 1;
  }
}

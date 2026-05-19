#!/usr/bin/env node
/**
 * Pre-download DuckDB VSS extension for air-gapped / offline deployments.
 *
 * Usage:
 *   node scripts/setup-duckdb.mjs [--dir <output-dir>]
 *
 * This script:
 *   1. Creates a temporary DuckDB instance
 *   2. Runs INSTALL vss to fetch the extension from the DuckDB repo
 *   3. Copies the downloaded .duckdb_extension file to <output-dir>
 *   4. Prints the path — set DUCKDB_VSS_PATH=<path> or DUCKDB_EXTENSION_DIRECTORY=<dir> in .env
 *
 * Example (air-gapped server setup):
 *   # On a machine WITH internet access:
 *   node scripts/setup-duckdb.mjs --dir /opt/duckdb-extensions
 *   # Copy /opt/duckdb-extensions/ to the air-gapped server
 *   # In .env on the server:
 *   DUCKDB_EXTENSION_DIRECTORY=/opt/duckdb-extensions
 */

import { createRequire } from 'module';
import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const dirIdx = args.indexOf('--dir');
const outputDir = dirIdx >= 0 ? args[dirIdx + 1] : join(process.cwd(), 'data', 'duckdb-extensions');

if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
    console.log(`Created output directory: ${outputDir}`);
}

console.log('Downloading DuckDB VSS extension (requires internet access)...');

let DuckDBInstance;
try {
    ({ DuckDBInstance } = require('@duckdb/node-api'));
} catch {
    console.error('ERROR: @duckdb/node-api is not installed. Run: npm install @duckdb/node-api');
    process.exit(1);
}

const tmpDb = join(outputDir, '_setup_tmp.duckdb');
try {
    const instance = await DuckDBInstance.create(tmpDb);
    const conn = await instance.connect();

    // Download to DuckDB's default home directory first
    await conn.run('INSTALL vss;');
    console.log('VSS extension downloaded to DuckDB default cache.');

    // Find the downloaded extension file
    const duckdbHome = process.env.DUCKDB_HOME ?? join(homedir(), '.duckdb');
    const extensionRoot = join(duckdbHome, 'extensions');

    let found = null;
    function findExt(dir) {
        if (!existsSync(dir)) return;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) {
                findExt(join(dir, entry.name));
            } else if (entry.name === 'vss.duckdb_extension') {
                found = join(dir, entry.name);
            }
        }
    }
    findExt(extensionRoot);

    if (found) {
        const dest = join(outputDir, 'vss.duckdb_extension');
        copyFileSync(found, dest);
        console.log(`\nVSS extension copied to: ${dest}`);
        console.log('\nTo use in an offline/air-gapped environment, add ONE of:');
        console.log(`  DUCKDB_VSS_PATH=${dest}`);
        console.log(`  DUCKDB_EXTENSION_DIRECTORY=${outputDir}`);
        console.log('\nOr set in .env file.');
    } else {
        // Even without copying, the extension is cached in DuckDB home
        console.log('\nExtension is cached in DuckDB home directory.');
        console.log('To specify a custom directory, set:');
        console.log(`  DUCKDB_EXTENSION_DIRECTORY=<path-to-your-extension-dir>`);
    }

    await conn.close?.();
    await instance.close?.();

    // Cleanup temp db files
    try {
        const { unlinkSync } = await import('fs');
        unlinkSync(tmpDb);
        unlinkSync(tmpDb + '.wal');
    } catch { /* ok if files don't exist */ }

    console.log('\nSetup complete.');
} catch (err) {
    console.error(`ERROR: ${err.message}`);
    console.error('\nIf you are behind a corporate proxy, set:');
    console.error('  HTTPS_PROXY=http://your-proxy:port');
    console.error('  HTTP_PROXY=http://your-proxy:port');
    process.exit(1);
}

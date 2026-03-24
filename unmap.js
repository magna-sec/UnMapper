#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');

// ─── ANSI colours (disabled when not a TTY) ──────────────────────────────────
const isTTY = process.stdout.isTTY;
const c = {
  reset:  isTTY ? '\x1b[0m'  : '',
  bold:   isTTY ? '\x1b[1m'  : '',
  dim:    isTTY ? '\x1b[2m'  : '',
  green:  isTTY ? '\x1b[32m' : '',
  yellow: isTTY ? '\x1b[33m' : '',
  cyan:   isTTY ? '\x1b[36m' : '',
  red:    isTTY ? '\x1b[31m' : '',
  grey:   isTTY ? '\x1b[90m' : '',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function usage() {
  console.log(`
${c.bold}unmap${c.reset} — source map unpacker

${c.bold}Usage:${c.reset}
  node unmap.js -p <file.map> [options]
  node unmap.js -d <directory> -o ./out

${c.bold}Options:${c.reset}
  -p, --map     <file>   Source map file(s) to unpack  ${c.dim}(repeatable)${c.reset}
  -d, --dir     <dir>    Directory to scan for *.map files ${c.dim}(repeatable)${c.reset}
  -o, --output  <dir>    Output directory              ${c.dim}[default: ./unpacked]${c.reset}
  -r, --recurse          Scan directories recursively
  -f, --flat             Flatten all files into output dir (no sub-folders)
  -q, --quiet            Only print errors
  -h, --help             Show this help

${c.bold}Examples:${c.reset}
  node unmap.js -p bundle.js.map
  node unmap.js -d ./maps -o ./src-recovered
  node unmap.js -d ./dist -r -o ./out
  node unmap.js -p a.map -p b.map -o ./out --flat
`);
}

function die(msg) {
  console.error(`${c.red}${c.bold}error:${c.reset} ${msg}`);
  process.exit(1);
}

/** Collect all *.map files in a directory, optionally recursive. */
function collectMapsFromDir(dir, recurse) {
  let results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    die(`cannot read directory "${dir}": ${e.message}`);
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && recurse) {
      results = results.concat(collectMapsFromDir(full, recurse));
    } else if (entry.isFile() && /\.map(\.|$)/i.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

/** Parse argv into { maps: string[], dirs: string[], output: string, recurse: bool, flat: bool, quiet: bool } */
function parseArgs(argv) {
  const args = { maps: [], dirs: [], output: './unpacked', recurse: false, flat: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help')     { usage(); process.exit(0); }
    if (a === '-f' || a === '--flat')     { args.flat    = true; continue; }
    if (a === '-q' || a === '--quiet')    { args.quiet   = true; continue; }
    if (a === '-r' || a === '--recurse')  { args.recurse = true; continue; }
    if (a === '-p' || a === '--map')      { args.maps.push(argv[++i]); continue; }
    if (a === '-d' || a === '--dir')      { args.dirs.push(argv[++i]); continue; }
    if (a === '-o' || a === '--output')   { args.output = argv[++i];   continue; }
    // positional — treat as map file
    if (!a.startsWith('-'))               { args.maps.push(a);          continue; }
    die(`unknown option: ${a}\nRun with --help for usage.`);
  }
  return args;
}

/**
 * Sanitise a source path so it can't escape the output directory.
 * - strips leading slashes / drive letters
 * - collapses ".." segments
 */
function sanitisePath(src) {
  // Remove URL scheme (webpack:// etc.) and leading slashes/drive letters
  let p = src.replace(/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//, '');  // strip scheme
  p = p.replace(/^\/+/, '');           // strip leading slashes
  p = p.replace(/^[a-zA-Z]:[/\\]/, ''); // strip Windows drive

  // Resolve without actually touching the filesystem
  const parts = p.split(/[/\\]/);
  const safe = [];
  for (const part of parts) {
    if (part === '..')  continue;   // skip traversal
    if (part === '.')   continue;   // skip self-ref
    if (part === '')    continue;   // skip empty
    safe.push(part);
  }
  return safe.join(path.sep) || '_unnamed';
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function formatBytes(n) {
  if (n < 1024)       return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Core unpacker ────────────────────────────────────────────────────────────

function unpackMap(mapFile, outDir, opts) {
  const { flat, quiet } = opts;

  if (!quiet) console.log(`\n${c.bold}${c.cyan}Unpacking${c.reset} ${c.bold}${mapFile}${c.reset}`);

  let raw;
  try {
    raw = fs.readFileSync(mapFile, 'utf8');
  } catch (e) {
    console.error(`  ${c.red}skip${c.reset} ${mapFile}: cannot read file (${e.message})`);
    return { written: 0, skipped: 0, noContent: 0, totalBytes: 0, failed: 1 };
  }

  let map;
  try {
    map = JSON.parse(raw);
  } catch (e) {
    console.error(`  ${c.red}skip${c.reset} ${mapFile}: invalid JSON (${e.message})`);
    return { written: 0, skipped: 0, noContent: 0, totalBytes: 0, failed: 1 };
  }

  if (!map.sources || !Array.isArray(map.sources)) {
    console.error(`  ${c.red}skip${c.reset} ${mapFile}: no "sources" array — not a valid source map`);
    return { written: 0, skipped: 0, noContent: 0, totalBytes: 0, failed: 1 };
  }

  const sources        = map.sources;
  const sourcesContent = map.sourcesContent || [];
  const total          = sources.length;
  const stats          = { written: 0, skipped: 0, noContent: 0, totalBytes: 0, failed: 0 };

  // Use the full filename as the sub-folder name — guarantees uniqueness across
  // versioned files like bundle.js.map.1 / bundle.js.map.2
  const mapBasename = path.basename(mapFile);
  const mapOutDir   = flat ? outDir : path.join(outDir, mapBasename);

  if (!quiet) {
    console.log(`  ${c.grey}${total} source(s) → ${mapOutDir}${c.reset}`);
    if (map.version) console.log(`  ${c.grey}source map version ${map.version}${c.reset}`);
  }

  for (let i = 0; i < total; i++) {
    const src     = sources[i];
    const content = sourcesContent[i];

    if (content == null) {
      if (!quiet) console.log(`  ${c.yellow}skip${c.reset}  ${src} ${c.grey}(no sourcesContent)${c.reset}`);
      stats.noContent++;
      continue;
    }

    const safeName = flat
      ? path.basename(sanitisePath(src)) || `source_${i}`
      : sanitisePath(src);

    const destPath = path.join(mapOutDir, safeName);

    try {
      writeFile(destPath, content);
      const bytes = Buffer.byteLength(content, 'utf8');
      stats.totalBytes += bytes;
      stats.written++;
      if (!quiet) {
        const rel = path.relative(process.cwd(), destPath);
        console.log(`  ${c.green}write${c.reset} ${rel} ${c.grey}(${formatBytes(bytes)})${c.reset}`);
      }
    } catch (e) {
      console.error(`  ${c.red}error${c.reset} ${src}: ${e.message}`);
      stats.skipped++;
    }
  }

  return stats;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv.slice(2));

  // Expand any -d directories into individual map file paths
  for (const dir of args.dirs) {
    const found = collectMapsFromDir(path.resolve(dir), args.recurse);
    if (found.length === 0) {
      console.warn(`${c.yellow}warn:${c.reset} no .map files found in "${dir}"${args.recurse ? '' : ' (try -r to recurse)'}`);
    }
    args.maps.push(...found);
  }

  if (args.maps.length === 0) {
    usage();
    die('no map file(s) found. Use -p <file.map> or -d <directory>');
  }

  const outDir = path.resolve(args.output);
  ensureDir(outDir);

  let totalWritten = 0, totalSkipped = 0, totalNoContent = 0, totalBytes = 0, totalFailed = 0;

  for (const mapFile of args.maps) {
    const s = unpackMap(path.resolve(mapFile), outDir, args);
    totalWritten    += s.written;
    totalSkipped    += s.skipped;
    totalNoContent  += s.noContent;
    totalBytes      += s.totalBytes;
    totalFailed     += s.failed;
  }

  // Summary
  const mapCount = args.maps.length;
  const mapWord  = mapCount === 1 ? 'map' : 'maps';
  console.log(`
${c.bold}Summary${c.reset}
  ${c.grey}Map files    :${c.reset} ${mapCount} ${mapWord}
  ${c.green}${c.bold}Written      :${c.reset} ${totalWritten} file(s)  ${c.grey}(${formatBytes(totalBytes)})${c.reset}
  ${c.yellow}No content   :${c.reset} ${totalNoContent} file(s)
  ${c.red}Skipped      :${c.reset} ${totalFailed} map file(s) ${c.grey}(bad/unreadable)${c.reset}
  ${c.red}Errors       :${c.reset} ${totalSkipped} source file(s)
  ${c.grey}Output dir   :${c.reset} ${path.resolve(args.output)}
`);

  process.exit((totalSkipped > 0 || totalFailed > 0) ? 1 : 0);
}

main();

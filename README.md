# unmap

A source map unpacker. Give it `.map` files and it writes the original source files back to disk.

No dependencies — just Node.js.

---

## Usage

```
node unmap.js -p <file.map> [options]
node unmap.js -d <directory>  [options]
```

### Options

| Flag | Long form | Description |
|------|-----------|-------------|
| `-p <file>` | `--map` | Source map file to unpack. Repeatable. |
| `-d <dir>` | `--dir` | Directory to scan for map files. Repeatable. |
| `-o <dir>` | `--output` | Output directory (default: `./unpacked`) |
| `-r` | `--recurse` | Scan directories recursively |
| `-f` | `--flat` | Dump all files into the output dir with no sub-folders |
| `-q` | `--quiet` | Only print errors |
| `-h` | `--help` | Show help |

---

## Examples

**Single file:**
```bash
node unmap.js -p bundle.js.map
```

**Custom output directory:**
```bash
node unmap.js -p bundle.js.map -o ./recovered
```

**Whole directory of map files:**
```bash
node unmap.js -d ./mapfiles -o ./recovered
```

**Recursive directory scan:**
```bash
node unmap.js -d ./dist -r -o ./recovered
```

**Multiple map files:**
```bash
node unmap.js -p app.js.map -p vendor.js.map -o ./out
```

**Mix files and directories:**
```bash
node unmap.js -p extra.js.map -d ./mapfiles -o ./out
```

**Flat output (no sub-folders):**
```bash
node unmap.js -d ./mapfiles --flat -o ./out
```

---

## Output structure

By default, each map file gets its own sub-folder inside the output directory, named after the map file. The original directory structure from the source map is preserved within that folder.

```
unpacked/
  bundle.js/
    src/
      components/
        App.jsx
        Header.jsx
      index.js
  vendor.js/
    node_modules/
      react/
        ...
```

With `--flat`, everything lands directly in the output directory (useful when you only have one map file or don't care about structure).

---

## File extension matching

The directory scanner matches any file with `.map` in the extension chain, so non-standard extensions like `.map.1`, `.map.gz` are picked up automatically alongside plain `.map` files.

---

## Notes

- Source files are only written if the map contains `sourcesContent`. If a source has no content entry it is skipped and reported in the summary.
- Source paths are sanitised before writing — URL schemes (`webpack://`, `ng://`, etc.), leading slashes, Windows drive letters, and `..` traversal segments are all stripped, so extracted files can't escape the output directory.
- Exit code is `0` on success, `1` if any files errored during writing.

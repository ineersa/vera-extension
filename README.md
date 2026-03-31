# Vera Search — VS Code Extension

Semantic code search inside VS Code powered by [Vera](https://github.com/nicepkg/vera).

Runs `vera search` (hybrid BM25 + vector) and `vera grep` (regex) in parallel, then renders ranked results in a persistent sidebar view with tabs and syntax-highlighted snippets.

## Requirements

- [Vera](https://github.com/nicepkg/vera) installed and available in `PATH`
- An indexed project (run `vera index .` in the project root)

## Install

### From source

```bash
git clone <repo-url> && cd vera-extension
npm install
npm run compile
```

Then in VS Code open this folder and press **F5** to launch the Extension Development Host.

### From VSIX

```bash
npm install -g @vscode/vsce
vsce package
code --install-extension vera-search-0.1.0.vsix
```

## Usage

1. Open a workspace that has a `.vera/` index
2. Press **Ctrl+Shift+\\** (or **Cmd+Shift+\\** on macOS) — or run **Vera: Search Code** from the Command Palette (`Ctrl+Shift+P`)
3. Vera sidebar opens on the left; type a query in the search box and press Enter
4. Results render in-place in the same sidebar with sectioned ranking and 3-line snippets
5. Use tabs to switch between All, Search, Grep, Classes, and Methods (`All` caps grep-only rows to 20, `Grep` shows up to 200 grep rows)
6. Select any result to jump to that file and line

If no index exists, the extension will offer to run `vera index .` for you.

## Development

```bash
npm install          # install dependencies
npm run compile      # production build
npm run watch        # watch mode (develop with F5)
npm run lint         # type-check only
```

## Configuration

- `veraSearch.searchLimit` (default: `20`) — max semantic search results.
- `veraSearch.grepLimit` (default: `200`) — max grep results.
- `veraSearch.allTabGrepLimit` (default: `20`) — grep-only rows shown in the `All` tab.

The extension uses `vera` from `PATH` and auto-detects the first workspace root.

## License

MIT

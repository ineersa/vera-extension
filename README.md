# Vera Search — VS Code Extension

Semantic code search inside VS Code powered by [Vera](https://github.com/lemon07r/Vera).

Runs `vera search` (hybrid BM25 + vector) and `vera grep` (regex) in parallel, renders ranked results in a persistent sidebar view, and can keep the index warm with background `vera watch`.

## Requirements

- [Vera](https://github.com/lemon07r/Vera) installed and available in `PATH`
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
3. Vera sidebar opens on the left; type a query, optionally enable **Deep** (`--deep`) or **Docs** (`--scope docs`), then press Enter
4. Results render in-place in the same sidebar with sectioned ranking and 3-line snippets
5. Use tabs to switch between All, Search, Grep, Classes, and Methods (`All` caps grep-only rows using `veraSearch.allTabGrepLimit`)
6. Select any result to jump to that file and line
7. With `veraSearch.autoWatch` enabled, the extension runs `vera watch` in background to keep the first workspace index fresh

If no index exists, the extension will offer to run `vera index .` for you.

## Development

```bash
npm install          # install dependencies
npm run compile      # production build
npm run watch        # watch mode (develop with F5)
npm run lint         # type-check only
```

## Configuration

- `veraSearch.command` (default: `vera`) — command used to run Vera; supports arguments (for example Docker wrappers).
- `veraSearch.searchLimit` (default: `20`) — max semantic search results.
- `veraSearch.grepLimit` (default: `200`) — max grep results.
- `veraSearch.allTabGrepLimit` (default: `20`) — grep-only rows shown in the `All` tab.
- `veraSearch.autoWatch` (default: `true`) — run `vera watch` in background when `.vera` exists.

The extension auto-detects the first workspace root and uses `veraSearch.command` for all Vera invocations.

### Docker example (`.vscode/settings.json`)

```json
{
  "veraSearch.command": "docker run --rm -i --add-host=host.docker.internal:host-gateway -v .:/workspace -v vera-config:/root/.vera -w /workspace -e EMBEDDING_MODEL_BASE_URL=http://host.docker.internal:8059/v1 -e EMBEDDING_MODEL_API_KEY=not-needed -e EMBEDDING_MODEL_ID=coderankembed-q8_0.gguf -e \"EMBEDDING_MODEL_QUERY_PREFIX=Represent this query for searching relevant code:\" -e RERANKER_MODEL_BASE_URL=http://host.docker.internal:8060/v1 -e RERANKER_MODEL_API_KEY=not-needed -e RERANKER_MODEL_ID=bge-reranker-base-q8_0.gguf -e RERANKER_MAX_DOCS_PER_REQUEST=8 -e RERANKER_MAX_DOCUMENT_CHARS=1200 -e VERA_COMPLETION_BASE_URL=http://host.docker.internal:8052/v1 -e VERA_COMPLETION_MODEL_ID=flash -e VERA_COMPLETION_API_KEY=not-needed vera:local"
}
```

Use `-v .:/workspace` instead of `$(pwd)` in this setting because the extension executes the command directly (without shell expansion).

## License

MIT

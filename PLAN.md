# Vera Search VSCode Extension - Plan

## Architecture

Vera JSON output (both `search` and `grep`) gives us:
```json
{
  "file_path": "src/foo.ts",
  "line_start": 10,
  "line_end": 15,
  "content": "...",
  "symbol_name": "parseConfig",
  "symbol_type": "function"
}
```

## UI Approach: Webview Panel in Editor Area

A webview panel is the right choice because:
- Rich code snippet display with syntax highlighting
- Clickable file:line links (via `vscode.window.showTextDocument`)
- Familiar search-results-like layout (grouped by file)
- Can be docked in any editor column

## User Flow

1. **Keybind** (`Shift+``) triggers command
2. **Input Box** appears for search query
3. `vera search <query> --json` and `vera grep <query> --json` run **in parallel**
4. Results are **merged/deduplicated** and displayed in a webview panel
5. Clicking a snippet opens the file at that line in the editor

## Extension Structure

```
vera-extension/
├── src/
│   ├── extension.ts        # Activate/deactivate, register commands + keybinds
│   ├── veraClient.ts       # Spawn vera CLI, parse JSON output
│   ├── searchPanel.ts      # Webview panel: render results, handle clicks
│   └── types.ts            # VeraResult interface
├── package.json            # Extension manifest (commands, keybinds, menus)
├── tsconfig.json
├── .vscodeignore
├── webpack.config.js       # Bundle for production
└── media/
    └── highlight.css       # VS Code theme-compatible syntax CSS
```

## Key Components

| Component | Purpose |
|---|---|
| `veraClient.ts` | Wraps `child_process.execFile` for `vera search` / `vera grep` with `--json`. Resolves workspace root, runs from correct cwd. |
| `searchPanel.ts` | Creates/maintains a single webview panel. Generates HTML with results grouped by file. Listens for `postMessage` clicks to open files. |
| `extension.ts` | Registers `vera.search` command with keybinding. On trigger: show input box → call vera → render panel. |

## Features

- **Parallel search**: Runs `vera search` (semantic) + `vera grep` (regex/exact) simultaneously
- **Dedup**: Merge results by `file_path + line_start`, keeping the richer result
- **Grouped display**: Results grouped by file, each showing line number + code snippet
- **Click to navigate**: Clicking any result opens `vscode.window.showTextDocument` at the exact line
- **Auto-index detection**: If no `.vera/` index exists, prompt to run `vera index`
- **Syntax highlighting**: Basic highlight.js-based highlighting for code snippets

## Keybinding

- `Shift+`` (backtick) → Open vera search input

## No sidebar icon - keybind only

## Dependencies

- Zero runtime npm dependencies (uses only `child_process` and VS Code API)
- `webpack` for bundling
- `@types/vscode` for types
- `highlight.js` (bundled into media)

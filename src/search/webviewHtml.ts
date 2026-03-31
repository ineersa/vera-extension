import * as vscode from 'vscode';
import { TAB_ORDER, TAB_TITLES, ViewState } from './sidebarTypes';

interface BootstrapData {
  readonly state: ViewState;
  readonly tabTitles: typeof TAB_TITLES;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildBootstrapData(state: ViewState): string {
  const data: BootstrapData = {
    state,
    tabTitles: TAB_TITLES,
  };
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export function buildSidebarHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  state: ViewState
): string {
  const cspSource = webview.cspSource;
  const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'sidebar.css'));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'sidebar.js'));
  const highlightUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'highlight.css'));

  const tabsHtml = TAB_ORDER.map(
    (tab) =>
      `<button class="tab-btn" data-tab="${tab}">${TAB_TITLES[tab]} <span class="tab-count">${state.counts[tab]}</span></button>`
  ).join('');

  const bootstrap = buildBootstrapData(state);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource}; script-src ${cspSource};">
  <link rel="stylesheet" href="${highlightUri}">
  <link rel="stylesheet" href="${cssUri}">
</head>
<body>
  <div class="root">
    <header class="toolbar">
      <form id="search-form" class="search-form">
        <input id="query-input" class="query-input" type="text" placeholder="Search symbols and code with Vera..." value="${escapeHtml(state.query)}" />
        <button id="search-button" class="search-btn" type="submit">Search</button>
      </form>
      <div id="status" class="status"></div>
      <div class="tabs">${tabsHtml}</div>
      <div id="error" class="error"></div>
    </header>
    <main id="results" class="results"></main>
  </div>

  <script id="vera-bootstrap" type="application/json">${bootstrap}</script>
  <script src="${scriptUri}"></script>
</body>
</html>`;
}

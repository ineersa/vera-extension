import * as path from 'path';
import * as vscode from 'vscode';
import { getVeraSearchSettings } from '../settings';
import { veraSearch } from '../veraClient';
import { isOpenFileMessage, isSearchMessage } from './messages';
import { compareResults, rankAndMergeResults } from './ranking';
import { SearchResultRenderer } from './resultRenderer';
import { buildSidebarHtml } from './webviewHtml';
import { emptyCounts, ViewState } from './sidebarTypes';

export class SearchSidebarViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'vera.searchSidebar';

  private view: vscode.WebviewView | undefined;
  private viewDisposables: vscode.Disposable[] = [];
  private providerDisposables: vscode.Disposable[] = [];
  private pendingFocus = false;
  private readonly renderer = new SearchResultRenderer();
  private searchRequestId = 0;
  private searchCts: vscode.CancellationTokenSource | undefined;

  private state: ViewState;

  constructor(private readonly extensionUri: vscode.Uri) {
    const settings = getVeraSearchSettings();
    this.state = {
      query: '',
      loading: false,
      error: '',
      results: [],
      counts: emptyCounts(),
      allTabGrepLimit: settings.allTabGrepLimit,
    };

    this.providerDisposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration('veraSearch.allTabGrepLimit')) {
          return;
        }

        const updated = getVeraSearchSettings();
        this.state = {
          ...this.state,
          allTabGrepLimit: updated.allTabGrepLimit,
        };
        this.postState();
      })
    );
  }

  public async revealAndFocus(): Promise<void> {
    await vscode.commands.executeCommand('workbench.view.extension.veraSearch');
    if (this.view) {
      this.view.show(false);
      this.focusQuery();
      return;
    }
    this.pendingFocus = true;
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.disposeViewDisposables();

    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };

    webviewView.webview.html = buildSidebarHtml(webviewView.webview, this.extensionUri, this.state);

    this.viewDisposables.push(
      webviewView.webview.onDidReceiveMessage((msg) => {
        void this.handleMessage(msg);
      }),
      webviewView.onDidDispose(() => {
        this.cancelPendingSearch();
        this.view = undefined;
        this.disposeViewDisposables();
      })
    );

    this.postState();
    if (this.pendingFocus) {
      this.pendingFocus = false;
      this.focusQuery();
    }
  }

  private async handleMessage(msg: unknown): Promise<void> {
    if (isSearchMessage(msg)) {
      await this.search(msg.query);
      return;
    }

    if (isOpenFileMessage(msg)) {
      await this.openResult(msg.file, msg.line);
    }
  }

  private async search(rawQuery: string): Promise<void> {
    const settings = getVeraSearchSettings();
    const query = rawQuery.trim();
    if (!query) {
      this.cancelPendingSearch();
      this.state = {
        query: '',
        loading: false,
        error: '',
        results: [],
        counts: emptyCounts(),
        allTabGrepLimit: settings.allTabGrepLimit,
      };
      this.postState();
      return;
    }

    this.cancelPendingSearch();
    const requestId = ++this.searchRequestId;
    const cts = new vscode.CancellationTokenSource();
    this.searchCts = cts;

    this.state = {
      ...this.state,
      query,
      loading: true,
      error: '',
      allTabGrepLimit: settings.allTabGrepLimit,
    };
    this.postState();

    try {
      const { searchResults, grepResults } = await veraSearch(query, cts.token);

      if (cts.token.isCancellationRequested || requestId !== this.searchRequestId) {
        return;
      }

      const ranked = rankAndMergeResults(query, searchResults, grepResults).sort(compareResults);

      this.state = {
        query,
        loading: false,
        error: '',
        allTabGrepLimit: settings.allTabGrepLimit,
        ...this.renderer.toUiState(ranked),
      };
      this.postState();
    } catch (err) {
      if (cts.token.isCancellationRequested || requestId !== this.searchRequestId) {
        return;
      }

      const message = err instanceof Error ? err.message : String(err);
      this.state = {
        ...this.state,
        loading: false,
        allTabGrepLimit: settings.allTabGrepLimit,
        error: `Vera search failed: ${message}`,
      };
      this.postState();
    } finally {
      if (this.searchCts === cts) {
        this.searchCts = undefined;
      }
      cts.dispose();
    }
  }

  private cancelPendingSearch(): void {
    if (!this.searchCts) {
      return;
    }

    this.searchCts.cancel();
    this.searchCts.dispose();
    this.searchCts = undefined;
  }

  private async openResult(file: string, line: number): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      vscode.window.showErrorMessage('No workspace folder open.');
      return;
    }

    const filePath = path.isAbsolute(file) ? file : path.join(root, file);
    const uri = vscode.Uri.file(filePath);

    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);

    const startLine = Math.max(0, Math.min(doc.lineCount - 1, line - 1));
    const endLine = Math.min(doc.lineCount - 1, startLine + 4);
    const endCharacter = doc.lineAt(endLine).text.length;

    editor.selection = new vscode.Selection(startLine, 0, endLine, endCharacter);
    editor.revealRange(new vscode.Range(startLine, 0, endLine, endCharacter), vscode.TextEditorRevealType.InCenter);
  }

  private postState(): void {
    if (!this.view) {
      return;
    }

    void this.view.webview.postMessage({
      type: 'state',
      state: this.state,
    });
  }

  private focusQuery(): void {
    if (!this.view) {
      this.pendingFocus = true;
      return;
    }

    void this.view.webview.postMessage({ type: 'focusQuery' });
  }

  private disposeViewDisposables(): void {
    for (const disposable of this.viewDisposables) {
      disposable.dispose();
    }
    this.viewDisposables = [];
  }

  public dispose(): void {
    this.cancelPendingSearch();
    this.disposeViewDisposables();
    for (const disposable of this.providerDisposables) {
      disposable.dispose();
    }
    this.providerDisposables = [];
    this.view = undefined;
  }
}

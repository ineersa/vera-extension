import * as path from 'path';
import * as vscode from 'vscode';
import { getVeraSearchSettings } from '../settings';
import {
  VeraConfigSnapshot,
  VeraConfigValue,
  veraConfigSnapshot,
  veraIndex,
  veraSearch,
  veraSetConfig,
} from '../veraClient';
import {
  isIndexMessage,
  isLoadConfigMessage,
  isOpenFileMessage,
  isSaveConfigMessage,
  isSearchMessage,
} from './messages';
import { compareResults, rankAndMergeResults } from './ranking';
import { SearchResultRenderer } from './resultRenderer';
import { buildSidebarHtml } from './webviewHtml';
import { ConfigEntry, ConfigValueType, emptyCounts, ViewState } from './sidebarTypes';

function getConfigValueType(value: VeraConfigValue): ConfigValueType {
  if (typeof value === 'string') {
    return 'string';
  }
  if (typeof value === 'number') {
    return 'number';
  }
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  return 'json';
}

function stringifyConfigValue(value: VeraConfigValue, valueType: ConfigValueType): string {
  if (valueType === 'json') {
    return JSON.stringify(value, null, 2);
  }
  if (typeof value === 'string') {
    return value;
  }
  return String(value);
}

function flattenConfig(snapshot: VeraConfigSnapshot): ConfigEntry[] {
  const entries: ConfigEntry[] = [];

  const pushEntry = (key: string, section: string, value: VeraConfigValue): void => {
    const valueType = getConfigValueType(value);
    entries.push({
      key,
      section,
      value: stringifyConfigValue(value, valueType),
      valueType,
    });
  };

  const walk = (value: VeraConfigValue, key: string, section: string): void => {
    if (Array.isArray(value)) {
      pushEntry(key, section, value);
      return;
    }

    if (value !== null && typeof value === 'object') {
      const nested = value as Record<string, VeraConfigValue>;
      const nestedKeys = Object.keys(nested).sort((a, b) => a.localeCompare(b));
      if (nestedKeys.length === 0) {
        pushEntry(key, section, value);
        return;
      }

      for (const nestedKey of nestedKeys) {
        walk(nested[nestedKey], `${key}.${nestedKey}`, section);
      }
      return;
    }

    pushEntry(key, section, value);
  };

  const sections = Object.keys(snapshot.config).sort((a, b) => a.localeCompare(b));
  for (const section of sections) {
    walk(snapshot.config[section], section, section);
  }

  return entries;
}

function parseConfigInput(entry: ConfigEntry, rawValue: string): string {
  switch (entry.valueType) {
    case 'boolean': {
      const normalized = rawValue.trim().toLowerCase();
      if (normalized !== 'true' && normalized !== 'false') {
        throw new Error('Boolean values must be `true` or `false`.');
      }
      return normalized;
    }
    case 'number': {
      const trimmed = rawValue.trim();
      if (!trimmed) {
        throw new Error('Number value cannot be empty.');
      }
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) {
        throw new Error('Number value is invalid.');
      }
      return String(parsed);
    }
    case 'json': {
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawValue);
      } catch {
        throw new Error('Invalid JSON.');
      }
      return JSON.stringify(parsed);
    }
    case 'string':
    default:
      return rawValue;
  }
}

export class SearchSidebarViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'vera.searchSidebar';

  private view: vscode.WebviewView | undefined;
  private viewDisposables: vscode.Disposable[] = [];
  private providerDisposables: vscode.Disposable[] = [];
  private pendingFocus = false;
  private readonly renderer = new SearchResultRenderer();
  private searchRequestId = 0;
  private searchCts: vscode.CancellationTokenSource | undefined;
  private readonly reportCliDiagnostic = (line: string): void => {
    this.output?.appendLine(line);
  };

  private state: ViewState;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onSearchLifecycle?: () => void,
    private readonly onConfigSaved?: () => void,
    private readonly output?: vscode.OutputChannel
  ) {
    const settings = getVeraSearchSettings();
    this.state = {
      query: '',
      deepSearch: false,
      docsScope: false,
      loading: false,
      indexing: false,
      error: '',
      results: [],
      counts: emptyCounts(),
      allTabGrepLimit: settings.allTabGrepLimit,
      configLoading: false,
      configSavingKey: '',
      configStatus: '',
      configError: '',
      configEntries: [],
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
      await this.search(msg.query, msg.deepSearch === true, msg.docsScope === true);
      return;
    }

    if (isOpenFileMessage(msg)) {
      await this.openResult(msg.file, msg.line);
      return;
    }

    if (isIndexMessage(msg)) {
      await this.indexWorkspace();
      return;
    }

    if (isLoadConfigMessage(msg)) {
      await this.loadConfig();
      return;
    }

    if (isSaveConfigMessage(msg)) {
      await this.saveConfigValue(msg.key, msg.value);
    }
  }

  private async readConfigEntries(): Promise<ConfigEntry[]> {
    const snapshot = await veraConfigSnapshot(undefined, this.reportCliDiagnostic);
    return flattenConfig(snapshot);
  }

  private async loadConfig(): Promise<void> {
    if (this.state.configLoading || this.state.configSavingKey.length > 0) {
      return;
    }

    this.state = {
      ...this.state,
      configLoading: true,
      configError: '',
      configStatus: '',
    };
    this.postState();

    try {
      const entries = await this.readConfigEntries();
      this.state = {
        ...this.state,
        configLoading: false,
        configEntries: entries,
        configError: '',
        configStatus: `Loaded ${entries.length} config values.`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.state = {
        ...this.state,
        configLoading: false,
        configError: `Failed to load config: ${message}`,
        configStatus: '',
      };
    }

    this.postState();
  }

  private async saveConfigValue(key: string, rawValue: string): Promise<void> {
    if (this.state.configLoading || this.state.configSavingKey.length > 0) {
      return;
    }

    const entry = this.state.configEntries.find((item) => item.key === key);
    if (!entry) {
      this.state = {
        ...this.state,
        configError: `Unknown config key: ${key}`,
        configStatus: '',
      };
      this.postState();
      return;
    }

    let value: string;
    try {
      value = parseConfigInput(entry, rawValue);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.state = {
        ...this.state,
        configError: `${key}: ${message}`,
        configStatus: '',
      };
      this.postState();
      return;
    }

    this.state = {
      ...this.state,
      configSavingKey: key,
      configError: '',
      configStatus: '',
    };
    this.postState();

    try {
      await veraSetConfig(key, value, undefined, this.reportCliDiagnostic);
      const entries = await this.readConfigEntries();
      this.state = {
        ...this.state,
        configSavingKey: '',
        configEntries: entries,
        configError: '',
        configStatus: `Saved ${key}. Triggered Vera watch reload.`,
      };
      this.onConfigSaved?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.state = {
        ...this.state,
        configSavingKey: '',
        configError: `Failed to save ${key}: ${message}`,
        configStatus: '',
      };
    }

    this.postState();
  }

  private async indexWorkspace(): Promise<void> {
    if (this.state.indexing) {
      return;
    }

    this.cancelPendingSearch();

    const settings = getVeraSearchSettings();
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '<no-workspace>';
    const commandText = `${settings.command.join(' ')} index .`;
    this.output?.appendLine(`[index] starting in ${root}: ${commandText}`);

    this.state = {
      ...this.state,
      loading: false,
      indexing: true,
      error: '',
      allTabGrepLimit: settings.allTabGrepLimit,
    };
    this.postState();

    try {
      await veraIndex(undefined, this.reportCliDiagnostic);
      this.state = {
        ...this.state,
        indexing: false,
        error: '',
        allTabGrepLimit: settings.allTabGrepLimit,
      };
      this.postState();
      this.output?.appendLine(`[index] completed in ${root}`);
      vscode.window.showInformationMessage('Vera index created.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.state = {
        ...this.state,
        indexing: false,
        error: `Vera index failed: ${message}`,
        allTabGrepLimit: settings.allTabGrepLimit,
      };
      this.postState();
      this.output?.appendLine(`[index] failed in ${root}: ${message}`);
    } finally {
      this.onSearchLifecycle?.();
    }
  }

  private async search(rawQuery: string, deepSearch: boolean, docsScope: boolean): Promise<void> {
    const settings = getVeraSearchSettings();
    const query = rawQuery.trim();
    if (!query) {
      this.cancelPendingSearch();
      this.state = {
        ...this.state,
        query: '',
        deepSearch,
        docsScope,
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
      deepSearch,
      docsScope,
      loading: true,
      error: '',
      allTabGrepLimit: settings.allTabGrepLimit,
    };
    this.postState();

    try {
      const { searchResults, grepResults } = await veraSearch(
        query,
        { deepSearch, docsScope },
        cts.token,
        this.reportCliDiagnostic
      );

      if (cts.token.isCancellationRequested || requestId !== this.searchRequestId) {
        return;
      }

      const ranked = rankAndMergeResults(query, searchResults, grepResults).sort(compareResults);

      this.state = {
        ...this.state,
        query,
        deepSearch,
        docsScope,
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
        deepSearch,
        docsScope,
        loading: false,
        allTabGrepLimit: settings.allTabGrepLimit,
        error: `Vera search failed: ${message}`,
      };
      this.postState();
    } finally {
      this.onSearchLifecycle?.();
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

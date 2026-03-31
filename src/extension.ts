import * as vscode from 'vscode';
import { SearchSidebarViewProvider } from './search/searchSidebarViewProvider';
import { VeraWatchManager } from './watch/veraWatchManager';

export function activate(context: vscode.ExtensionContext): void {
  const watchManager = new VeraWatchManager();
  void watchManager.refresh();

  const provider = new SearchSidebarViewProvider(context.extensionUri, () => {
    void watchManager.refresh();
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SearchSidebarViewProvider.viewType, provider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
    provider,
    watchManager
  );

  const command = vscode.commands.registerCommand('vera.search', async () => {
    await provider.revealAndFocus();
  });

  context.subscriptions.push(command);
}

export function deactivate(): void {
  // No-op.
}

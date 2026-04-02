import * as vscode from 'vscode';
import { SearchSidebarViewProvider } from './search/searchSidebarViewProvider';
import { VeraWatchManager } from './watch/veraWatchManager';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Vera Search');
  const watchManager = new VeraWatchManager(output);
  void watchManager.refresh();

  const provider = new SearchSidebarViewProvider(
    context.extensionUri,
    () => {
      void watchManager.refresh();
    },
    () => {
      void watchManager.restart('vera config updated');
    },
    output
  );

  context.subscriptions.push(
    output,
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

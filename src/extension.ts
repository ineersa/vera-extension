import * as vscode from 'vscode';
import { SearchSidebarViewProvider } from './search/searchSidebarViewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new SearchSidebarViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SearchSidebarViewProvider.viewType, provider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
    provider
  );

  const command = vscode.commands.registerCommand('vera.search', async () => {
    await provider.revealAndFocus();
  });

  context.subscriptions.push(command);
}

export function deactivate(): void {
  // No-op.
}

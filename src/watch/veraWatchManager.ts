import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getVeraSearchSettings } from '../settings';

function getWorkspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }
  return folders[0].uri.fsPath;
}

function hasVeraIndex(workspaceRoot: string): boolean {
  return fs.existsSync(path.join(workspaceRoot, '.vera'));
}

export class VeraWatchManager implements vscode.Disposable {
  private readonly output = vscode.window.createOutputChannel('Vera Search');
  private readonly disposables: vscode.Disposable[] = [];
  private watcher: ChildProcess | undefined;
  private watcherRoot: string | undefined;
  private watcherCommand: string | undefined;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor() {
    this.disposables.push(
      this.output,
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          !event.affectsConfiguration('veraSearch.autoWatch') &&
          !event.affectsConfiguration('veraSearch.command')
        ) {
          return;
        }
        void this.refresh();
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void this.refresh();
      })
    );
  }

  public async refresh(): Promise<void> {
    this.clearRestartTimer();

    if (this.disposed) {
      return;
    }

    const settings = getVeraSearchSettings();
    const root = getWorkspaceRoot();
    const commandKey = settings.command.join('\u0000');

    if (!settings.autoWatch || !root || !hasVeraIndex(root)) {
      this.stopWatcher();
      return;
    }

    if (this.watcher && this.watcherRoot === root && this.watcherCommand === commandKey) {
      return;
    }

    this.stopWatcher();
    this.startWatcher(root, settings.command);
  }

  private startWatcher(root: string, command: readonly string[]): void {
    const [binary = 'vera', ...commandArgs] = command;

    const child = spawn(binary, [...commandArgs, 'watch', '.', '--json'], {
      cwd: root,
      env: process.env,
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    this.watcher = child;
    this.watcherRoot = root;
    this.watcherCommand = command.join('\u0000');
    this.output.appendLine(`[watch] started in ${root}`);

    child.stderr?.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString().trim();
      if (!text) {
        return;
      }
      this.output.appendLine(`[watch] ${text}`);
    });

    child.on('error', (error: Error & { code?: string }) => {
      if (this.watcher !== child) {
        return;
      }

      this.watcher = undefined;
      this.watcherRoot = undefined;
      this.watcherCommand = undefined;
      this.output.appendLine(`[watch] failed to start: ${error.message}`);

      if (error.code === 'ENOENT') {
        return;
      }
      this.scheduleRestart();
    });

    child.on('close', (code, signal) => {
      if (this.watcher !== child) {
        return;
      }

      this.watcher = undefined;
      this.watcherRoot = undefined;
      this.watcherCommand = undefined;

      if (this.disposed) {
        return;
      }

      this.output.appendLine(
        `[watch] stopped (code=${String(code)}, signal=${signal ?? 'none'}), retrying in 2s`
      );
      this.scheduleRestart();
    });
  }

  private stopWatcher(): void {
    this.clearRestartTimer();

    if (!this.watcher) {
      return;
    }

    const child = this.watcher;
    this.watcher = undefined;
    this.watcherRoot = undefined;
    this.watcherCommand = undefined;
    child.kill();
  }

  private scheduleRestart(): void {
    this.clearRestartTimer();
    this.restartTimer = setTimeout(() => {
      void this.refresh();
    }, 2000);
  }

  private clearRestartTimer(): void {
    if (!this.restartTimer) {
      return;
    }
    clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
  }

  public dispose(): void {
    this.disposed = true;
    this.stopWatcher();

    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
  }
}

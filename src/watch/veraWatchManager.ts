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

const WATCH_DIAGNOSTIC_PATTERN = /\b(warn(?:ing)?|error|fatal|panic|failed?)\b/i;

function toWatchDiagnostic(rawLine: string): string | undefined {
  const line = rawLine.trim();
  if (!line) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed === 'string') {
      return WATCH_DIAGNOSTIC_PATTERN.test(parsed) ? parsed : undefined;
    }

    if (parsed !== null && typeof parsed === 'object') {
      const payload = parsed as Record<string, unknown>;
      const level = [payload.level, payload.severity, payload.kind, payload.type, payload.event]
        .filter((value): value is string => typeof value === 'string')
        .join(' ')
        .toLowerCase();
      const message = [payload.message, payload.msg, payload.error, payload.warning]
        .filter((value): value is string => typeof value === 'string')
        .find((value) => value.trim().length > 0);

      if (WATCH_DIAGNOSTIC_PATTERN.test(level)) {
        return message ?? line;
      }

      if (message && WATCH_DIAGNOSTIC_PATTERN.test(message)) {
        return message;
      }
    }
  } catch {
    // Non-JSON stderr lines are handled below.
  }

  return WATCH_DIAGNOSTIC_PATTERN.test(line) ? line : undefined;
}

function flushWatchStderrBuffer(
  output: vscode.OutputChannel,
  buffer: string,
  flushTrailing = false
): string {
  const lines = buffer.split(/\r?\n|\r/g);
  const trailing = flushTrailing ? '' : lines.pop() ?? '';

  for (const rawLine of lines) {
    const diagnostic = toWatchDiagnostic(rawLine);
    if (diagnostic) {
      output.appendLine(`[watch] ${diagnostic}`);
    }
  }

  return trailing;
}

export class VeraWatchManager implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private watcher: ChildProcess | undefined;
  private watcherRoot: string | undefined;
  private watcherCommand: string | undefined;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(private readonly output: vscode.OutputChannel) {
    this.disposables.push(
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

  public async restart(reason = 'config update'): Promise<void> {
    this.clearRestartTimer();

    if (this.disposed) {
      return;
    }

    this.output.appendLine(`[watch] restarting (${reason})`);
    this.stopWatcher();
    await this.refresh();
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

    let stderrBuffer = '';

    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderrBuffer += chunk.toString();
      stderrBuffer = flushWatchStderrBuffer(this.output, stderrBuffer);
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

      stderrBuffer = flushWatchStderrBuffer(this.output, stderrBuffer, true);

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

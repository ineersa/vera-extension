import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { VeraResult } from './types';
import { getVeraSearchSettings } from './settings';

export interface VeraSearchOptions {
  readonly deepSearch?: boolean;
  readonly docsScope?: boolean;
}

export type VeraConfigValue =
  | string
  | number
  | boolean
  | null
  | VeraConfigValue[]
  | { [key: string]: VeraConfigValue };

export interface VeraConfigSnapshot {
  readonly config: Record<string, VeraConfigValue>;
}

type StderrReporter = (line: string) => void;

const DIAGNOSTIC_PATTERN = /\b(warn(?:ing)?|error|fatal|panic|failed?)\b/i;

function escapeRegexPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function dedupByLocation(results: VeraResult[]): VeraResult[] {
  const seen = new Map<string, VeraResult>();
  for (const result of results) {
    seen.set(`${result.file_path}:${result.line_start}`, result);
  }
  return Array.from(seen.values());
}

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

function toDiagnosticLine(rawLine: string): string | undefined {
  const line = rawLine.trim();
  if (!line) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed === 'string') {
      return DIAGNOSTIC_PATTERN.test(parsed) ? parsed : undefined;
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

      if (DIAGNOSTIC_PATTERN.test(level)) {
        return message ?? line;
      }

      if (message && DIAGNOSTIC_PATTERN.test(message)) {
        return message;
      }
    }
  } catch {
    // Non-JSON stderr lines are handled below.
  }

  return DIAGNOSTIC_PATTERN.test(line) ? line : undefined;
}

function reportStderrLines(
  stderr: string,
  reporter?: StderrReporter,
  includeAll = false
): void {
  if (!reporter) {
    return;
  }

  const lines = stderr.split(/\r?\n|\r/g);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (includeAll) {
      reporter(line);
      continue;
    }

    const diagnostic = toDiagnosticLine(line);
    if (diagnostic) {
      reporter(diagnostic);
    }
  }
}

function withCommandLabel(
  label: string,
  reporter?: StderrReporter
): StderrReporter | undefined {
  if (!reporter) {
    return undefined;
  }

  return (line: string) => {
    reporter(`[${label}] ${line}`);
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeConfigValue(value: unknown): VeraConfigValue {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeConfigValue(item));
  }

  if (isPlainObject(value)) {
    const normalized: Record<string, VeraConfigValue> = {};
    for (const [key, nested] of Object.entries(value)) {
      normalized[key] = normalizeConfigValue(nested);
    }
    return normalized;
  }

  return String(value);
}

function runVeraCommand(
  command: readonly string[],
  args: string[],
  cwd: string,
  token?: vscode.CancellationToken,
  onStderrLine?: StderrReporter
): Promise<string> {
  const [binary = 'vera', ...commandArgs] = command;

  return new Promise((resolve, reject) => {
    const child = spawn(binary, [...commandArgs, ...args], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    const settle = (err: Error | null, code: number | null): void => {
      if (settled) {
        return;
      }
      settled = true;

      cancellation?.dispose();

      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      const stderrText = stderr.trim();

      if (stderrText) {
        reportStderrLines(stderrText, onStderrLine, err !== null || (code ?? 1) !== 0);
      }

      if (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(
            new Error(
              `Vera command not found: ${binary}. Check veraSearch.command and ensure it is available in PATH.`
            )
          );
          return;
        }
        reject(err);
        return;
      }

      if (code !== 0) {
        const stdoutText = stdout.trim();
        if (stderrText) {
          reject(new Error(stderrText));
          return;
        }
        if (stdoutText) {
          reject(new Error(stdoutText));
          return;
        }
        reject(new Error(`Vera command exited with code ${String(code)}`));
        return;
      }

      resolve(stdout);
    };

    let cancellation: vscode.Disposable | undefined;

    child.on('error', (err) => {
      settle(err, null);
    });

    child.on('exit', (code) => {
      settle(null, code);
    });

    if (token) {
      if (token.isCancellationRequested) {
        child.kill();
        reject(new Error('Search cancelled.'));
        return;
      }

      cancellation = token.onCancellationRequested(() => {
        child.kill();
        settle(new Error('Search cancelled.'), null);
      });
    }
  });
}

function runVera(
  command: readonly string[],
  args: string[],
  cwd: string,
  token?: vscode.CancellationToken,
  onStderrLine?: StderrReporter
): Promise<VeraResult[]> {
  return new Promise((resolve, reject) => {
    runVeraCommand(command, args, cwd, token, onStderrLine)
      .then((stdout) => {
        try {
          const parsed = JSON.parse(stdout);
          if (Array.isArray(parsed)) {
            resolve(parsed as VeraResult[]);
          } else {
            resolve([]);
          }
        } catch {
          resolve([]);
        }
      })
      .catch((error: unknown) => {
        reject(error);
      });
  });
}

export async function veraIndex(
  token?: vscode.CancellationToken,
  onStderrLine?: StderrReporter
): Promise<void> {
  const root = getWorkspaceRoot();
  if (!root) {
    throw new Error('No workspace folder open.');
  }

  if (token?.isCancellationRequested) {
    throw new Error('Index cancelled.');
  }

  const settings = getVeraSearchSettings();
  await runVeraCommand(
    settings.command,
    ['index', '.'],
    root,
    token,
    withCommandLabel('index', onStderrLine)
  );
}

export async function veraConfigSnapshot(
  token?: vscode.CancellationToken,
  onStderrLine?: StderrReporter
): Promise<VeraConfigSnapshot> {
  const root = getWorkspaceRoot();
  if (!root) {
    throw new Error('No workspace folder open.');
  }

  if (token?.isCancellationRequested) {
    throw new Error('Config read cancelled.');
  }

  const settings = getVeraSearchSettings();
  const jsonOutput = await runVeraCommand(
    settings.command,
    ['config', '--json'],
    root,
    token,
    withCommandLabel('config', onStderrLine)
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonOutput);
  } catch {
    throw new Error('Failed to parse `vera config --json` output.');
  }

  if (!isPlainObject(parsed)) {
    throw new Error('Unexpected `vera config --json` output format.');
  }

  const config: Record<string, VeraConfigValue> = {};
  for (const [key, value] of Object.entries(parsed)) {
    config[key] = normalizeConfigValue(value);
  }

  return {
    config,
  };
}

export async function veraSetConfig(
  key: string,
  value: string,
  token?: vscode.CancellationToken,
  onStderrLine?: StderrReporter
): Promise<void> {
  const root = getWorkspaceRoot();
  if (!root) {
    throw new Error('No workspace folder open.');
  }

  if (token?.isCancellationRequested) {
    throw new Error('Config update cancelled.');
  }

  const settings = getVeraSearchSettings();
  await runVeraCommand(
    settings.command,
    ['config', '--json', 'set', key, value],
    root,
    token,
    withCommandLabel('config', onStderrLine)
  );
}

export async function veraSearch(
  query: string,
  options: VeraSearchOptions = {},
  token?: vscode.CancellationToken,
  onStderrLine?: StderrReporter
): Promise<{ searchResults: VeraResult[]; grepResults: VeraResult[] }> {
  const root = getWorkspaceRoot();
  if (!root) {
    throw new Error('No workspace folder open.');
  }

  if (token?.isCancellationRequested) {
    throw new Error('Search cancelled.');
  }

  const settings = getVeraSearchSettings();
  const deepSearch = options.deepSearch === true;
  const docsScope = options.docsScope === true;

  if (!hasVeraIndex(root)) {
    const configuredCommand = settings.command.join(' ');
    const indexCommand = `${configuredCommand} index .`;
    const choice = await vscode.window.showWarningMessage(
      `No Vera index found in this workspace. Run \`${indexCommand}\` first?`,
      'Run index',
      'Cancel'
    );
    if (choice === 'Run index') {
      await runVeraCommand(
        settings.command,
        ['index', '.'],
        root,
        token,
        withCommandLabel('index', onStderrLine)
      );
      vscode.window.showInformationMessage('Vera index created.');
    } else {
      throw new Error('No Vera index available.');
    }
  }

  const escapedQuery = escapeRegexPattern(query);
  const runLiteralGrep = escapedQuery !== query;

  const searchArgs = ['search', query, '--json', '-n', String(settings.searchLimit)];
  if (deepSearch) {
    searchArgs.push('--deep');
  }
  if (docsScope) {
    searchArgs.push('--scope', 'docs');
  }

  const [searchResults, grepRegexResults, grepLiteralResults] = await Promise.allSettled([
    runVera(
      settings.command,
      searchArgs,
      root,
      token,
      withCommandLabel('search', onStderrLine)
    ),
    runVera(
      settings.command,
      ['grep', query, '--json', '-n', String(settings.grepLimit)],
      root,
      token,
      withCommandLabel('grep', onStderrLine)
    ),
    runLiteralGrep
      ? runVera(
          settings.command,
          ['grep', escapedQuery, '--json', '-n', String(settings.grepLimit)],
          root,
          token,
          withCommandLabel('grep', onStderrLine)
        )
      : Promise.resolve([] as VeraResult[]),
  ]);

  const mergedGrep = dedupByLocation([
    ...(grepRegexResults.status === 'fulfilled' ? grepRegexResults.value : []),
    ...(grepLiteralResults.status === 'fulfilled' ? grepLiteralResults.value : []),
  ]).slice(0, settings.grepLimit);

  return {
    searchResults: searchResults.status === 'fulfilled' ? searchResults.value : [],
    grepResults: mergedGrep,
  };
}

export function dedupResults(
  searchResults: VeraResult[],
  grepResults: VeraResult[]
): VeraResult[] {
  const seen = new Map<string, VeraResult>();

  for (const r of grepResults) {
    const key = `${r.file_path}:${r.line_start}`;
    if (!seen.has(key)) {
      seen.set(key, r);
    }
  }

  for (const r of searchResults) {
    const key = `${r.file_path}:${r.line_start}`;
    seen.set(key, r);
  }

  return Array.from(seen.values());
}

export function groupByFile(
  results: VeraResult[]
): Map<string, VeraResult[]> {
  const groups = new Map<string, VeraResult[]>();
  for (const r of results) {
    const existing = groups.get(r.file_path) || [];
    existing.push(r);
    groups.set(r.file_path, existing);
  }
  return groups;
}

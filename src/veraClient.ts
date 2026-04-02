import { execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { VeraResult } from './types';
import { getVeraSearchSettings } from './settings';

export interface VeraSearchOptions {
  readonly deepSearch?: boolean;
  readonly docsScope?: boolean;
}

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

function runVera(
  command: readonly string[],
  args: string[],
  cwd: string,
  token?: vscode.CancellationToken
): Promise<VeraResult[]> {
  const [binary = 'vera', ...commandArgs] = command;

  return new Promise((resolve, reject) => {
    const child = execFile(
      binary,
      [...commandArgs, ...args],
      { cwd, maxBuffer: 50 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          if (error.code === 'ENOENT') {
            reject(
              new Error(
                `Vera command not found: ${binary}. Check veraSearch.command and ensure it is available in PATH.`
              )
            );
            return;
          }
          if (stderr && !stdout) {
            reject(new Error(stderr.trim()));
            return;
          }
        }
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
      }
    );

    if (!token) {
      return;
    }

    if (token.isCancellationRequested) {
      child.kill();
      reject(new Error('Search cancelled.'));
      return;
    }

    const cancellation = token.onCancellationRequested(() => {
      child.kill();
      reject(new Error('Search cancelled.'));
    });

    child.on('close', () => {
      cancellation.dispose();
    });
  });
}

export async function veraSearch(
  query: string,
  options: VeraSearchOptions = {},
  token?: vscode.CancellationToken
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
      await runVera(settings.command, ['index', '.'], root, token);
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
    runVera(settings.command, searchArgs, root, token),
    runVera(settings.command, ['grep', query, '--json', '-n', String(settings.grepLimit)], root, token),
    runLiteralGrep
      ? runVera(settings.command, ['grep', escapedQuery, '--json', '-n', String(settings.grepLimit)], root, token)
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

import * as vscode from 'vscode';

const DEFAULT_SEARCH_LIMIT = 20;
const DEFAULT_GREP_LIMIT = 200;
const DEFAULT_ALL_TAB_GREP_LIMIT = 20;
const DEFAULT_AUTO_WATCH = true;
const DEFAULT_VERA_COMMAND = 'vera';

export interface VeraSearchSettings {
  readonly searchLimit: number;
  readonly grepLimit: number;
  readonly allTabGrepLimit: number;
  readonly autoWatch: boolean;
  readonly command: readonly string[];
}

function readBoolean(config: vscode.WorkspaceConfiguration, key: string, fallback: boolean): boolean {
  const value = config.get<boolean>(key, fallback);
  return typeof value === 'boolean' ? value : fallback;
}

function readString(config: vscode.WorkspaceConfiguration, key: string, fallback: string): string {
  const value = config.get<string>(key, fallback);
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function parseCommand(command: string): string[] {
  const parsed: string[] = [];
  let current = '';
  let quote: '"' | '\'' | undefined;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];

    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else if (char === '\\' && quote === '"' && index + 1 < command.length) {
        const next = command[index + 1];
        if (next === '"' || next === '\\') {
          current += next;
          index += 1;
        } else {
          current += char;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === '\'') {
      quote = char;
      continue;
    }

    if (char === '\\' && index + 1 < command.length) {
      const next = command[index + 1];
      if (/\s/.test(next) || next === '"' || next === '\'' || next === '\\') {
        current += next;
        index += 1;
        continue;
      }
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        parsed.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    parsed.push(current);
  }

  return parsed.length > 0 ? parsed : [DEFAULT_VERA_COMMAND];
}

function readNumber(
  config: vscode.WorkspaceConfiguration,
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  const value = config.get<number>(key, fallback);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.floor(value);
  return Math.max(min, Math.min(max, rounded));
}

export function getVeraSearchSettings(): VeraSearchSettings {
  const config = vscode.workspace.getConfiguration('veraSearch');

  return {
    searchLimit: readNumber(config, 'searchLimit', DEFAULT_SEARCH_LIMIT, 1, 500),
    grepLimit: readNumber(config, 'grepLimit', DEFAULT_GREP_LIMIT, 1, 2000),
    allTabGrepLimit: readNumber(config, 'allTabGrepLimit', DEFAULT_ALL_TAB_GREP_LIMIT, 1, 500),
    autoWatch: readBoolean(config, 'autoWatch', DEFAULT_AUTO_WATCH),
    command: parseCommand(readString(config, 'command', DEFAULT_VERA_COMMAND)),
  };
}

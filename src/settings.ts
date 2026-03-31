import * as vscode from 'vscode';

const DEFAULT_SEARCH_LIMIT = 20;
const DEFAULT_GREP_LIMIT = 200;
const DEFAULT_ALL_TAB_GREP_LIMIT = 20;

export interface VeraSearchSettings {
  readonly searchLimit: number;
  readonly grepLimit: number;
  readonly allTabGrepLimit: number;
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
  };
}

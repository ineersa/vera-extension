import { VeraResult } from '../types';
import {
  MatchBucket,
  RankedResult,
  ResultSource,
  ResultTab,
  SymbolGroup,
  UiResult,
} from './sidebarTypes';

function normalize(text: string | undefined): string {
  return text?.trim().toLowerCase() ?? '';
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inferSymbolGroup(symbolType: string | undefined): SymbolGroup {
  const kind = normalize(symbolType);
  if (!kind) {
    return 'other';
  }

  if (
    ['class', 'struct', 'interface', 'trait', 'enum', 'namespace', 'module'].some((token) =>
      kind.includes(token)
    )
  ) {
    return 'class';
  }

  if (
    ['method', 'function', 'func', 'fn', 'constructor', 'lambda', 'procedure'].some((token) =>
      kind.includes(token)
    )
  ) {
    return 'method';
  }

  if (
    ['variable', 'var', 'const', 'field', 'property', 'member', 'parameter', 'param', 'attribute'].some(
      (token) => kind.includes(token)
    )
  ) {
    return 'variable';
  }

  return 'other';
}

function rankMatch(query: string, result: VeraResult): { rank: number; bucket: MatchBucket } {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return { rank: 10, bucket: 'other' };
  }

  const symbol = normalize(result.symbol_name);
  if (symbol && symbol === normalizedQuery) {
    return { rank: 0, bucket: 'exact' };
  }

  if (symbol && symbol.startsWith(normalizedQuery)) {
    return { rank: 1, bucket: 'partial' };
  }

  if (symbol && symbol.includes(normalizedQuery)) {
    return { rank: 2, bucket: 'partial' };
  }

  const wordRegex = new RegExp(`\\b${escapeRegExp(normalizedQuery)}\\b`, 'i');
  if (wordRegex.test(result.content)) {
    return { rank: 3, bucket: 'other' };
  }

  if (result.content.toLowerCase().includes(normalizedQuery)) {
    return { rank: 4, bucket: 'other' };
  }

  return { rank: 5, bucket: 'other' };
}

function sourceWeight(source: ResultSource): number {
  switch (source) {
    case 'both':
      return 0;
    case 'search':
      return 1;
    case 'grep':
      return 2;
    default:
      return 99;
  }
}

function symbolWeight(symbolGroup: SymbolGroup): number {
  switch (symbolGroup) {
    case 'class':
      return 0;
    case 'method':
      return 1;
    case 'variable':
      return 2;
    case 'other':
      return 3;
    default:
      return 99;
  }
}

export function compareResults(a: RankedResult, b: RankedResult): number {
  if (a.rank !== b.rank) {
    return a.rank - b.rank;
  }

  const bySymbol = symbolWeight(a.symbolGroup) - symbolWeight(b.symbolGroup);
  if (bySymbol !== 0) {
    return bySymbol;
  }

  const bySource = sourceWeight(a.source) - sourceWeight(b.source);
  if (bySource !== 0) {
    return bySource;
  }

  const byFile = a.result.file_path.localeCompare(b.result.file_path);
  if (byFile !== 0) {
    return byFile;
  }

  return a.result.line_start - b.result.line_start;
}

function keyForResult(result: VeraResult): string {
  return `${result.file_path}:${result.line_start}`;
}

export function rankAndMergeResults(
  query: string,
  searchResults: VeraResult[],
  grepResults: VeraResult[]
): RankedResult[] {
  const merged = new Map<string, { result: VeraResult; source: ResultSource }>();

  for (const result of grepResults) {
    merged.set(keyForResult(result), { result, source: 'grep' });
  }

  for (const result of searchResults) {
    const key = keyForResult(result);
    if (merged.has(key)) {
      merged.set(key, { result, source: 'both' });
    } else {
      merged.set(key, { result, source: 'search' });
    }
  }

  return Array.from(merged.values(), ({ result, source }) => {
    const ranked = rankMatch(query, result);
    return {
      result,
      source,
      symbolGroup: inferSymbolGroup(result.symbol_type),
      rank: ranked.rank,
      bucket: ranked.bucket,
    };
  });
}

export function matchesTab(result: RankedResult | UiResult, tab: ResultTab): boolean {
  switch (tab) {
    case 'all':
      return true;
    case 'search':
      return result.source === 'search' || result.source === 'both';
    case 'grep':
      return result.source === 'grep' || result.source === 'both';
    case 'classes':
      return result.symbolGroup === 'class';
    case 'methods':
      return result.symbolGroup === 'method';
    default:
      return true;
  }
}

import { VeraResult } from '../types';

export type ResultSource = 'search' | 'grep' | 'both';
export type ResultTab = 'all' | 'search' | 'grep' | 'classes' | 'methods';
export type SymbolGroup = 'class' | 'method' | 'variable' | 'other';
export type MatchBucket = 'exact' | 'partial' | 'other';
export type ConfigValueType = 'string' | 'number' | 'boolean' | 'json';

export interface RankedResult {
  readonly result: VeraResult;
  readonly source: ResultSource;
  readonly symbolGroup: SymbolGroup;
  readonly rank: number;
  readonly bucket: MatchBucket;
}

export interface UiResult {
  readonly filePath: string;
  readonly lineStart: number;
  readonly source: ResultSource;
  readonly symbolGroup: SymbolGroup;
  readonly bucket: MatchBucket;
  readonly html: string;
}

export interface ConfigEntry {
  readonly key: string;
  readonly section: string;
  readonly value: string;
  readonly valueType: ConfigValueType;
}

export interface ViewState {
  readonly query: string;
  readonly deepSearch: boolean;
  readonly docsScope: boolean;
  readonly loading: boolean;
  readonly indexing: boolean;
  readonly error: string;
  readonly results: UiResult[];
  readonly counts: Record<ResultTab, number>;
  readonly allTabGrepLimit: number;
  readonly configLoading: boolean;
  readonly configSavingKey: string;
  readonly configStatus: string;
  readonly configError: string;
  readonly configEntries: ConfigEntry[];
}

export const TAB_ORDER: readonly ResultTab[] = ['all', 'search', 'grep', 'classes', 'methods'];

export const TAB_TITLES: Record<ResultTab, string> = {
  all: 'All',
  search: 'Search',
  grep: 'Grep',
  classes: 'Classes',
  methods: 'Methods',
};

export function emptyCounts(): Record<ResultTab, number> {
  return {
    all: 0,
    search: 0,
    grep: 0,
    classes: 0,
    methods: 0,
  };
}

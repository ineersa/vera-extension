export interface VeraResult {
  file_path: string;
  line_start: number;
  line_end: number;
  content: string;
  symbol_name?: string;
  symbol_type?: string;
}

export interface VeraSearchResponse {
  query: string;
  results: VeraResult[];
  grepResults: VeraResult[];
}

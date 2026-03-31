import * as path from 'path';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import type { LanguageFn } from 'highlight.js';
import { VeraResult } from '../types';
import { matchesTab } from './ranking';
import {
  emptyCounts,
  RankedResult,
  ResultSource,
  SymbolGroup,
  TAB_ORDER,
  UiResult,
  ViewState,
} from './sidebarTypes';

const SNIPPET_LINES = 3;
const SNIPPET_LINE_LIMIT = 220;

const REGISTERED_LANGUAGES: Array<[string, LanguageFn]> = [
  ['bash', bash],
  ['c', c],
  ['cpp', cpp],
  ['css', css],
  ['go', go],
  ['java', java],
  ['javascript', javascript],
  ['json', json],
  ['kotlin', kotlin],
  ['markdown', markdown],
  ['php', php],
  ['python', python],
  ['rust', rust],
  ['sql', sql],
  ['swift', swift],
  ['typescript', typescript],
  ['xml', xml],
  ['yaml', yaml],
];

for (const [name, definition] of REGISTERED_LANGUAGES) {
  hljs.registerLanguage(name, definition);
}

export class SearchResultRenderer {
  public toUiState(ranked: RankedResult[]): Pick<ViewState, 'results' | 'counts'> {
    const counts = emptyCounts();
    const results = ranked.map((item): UiResult => {
      for (const tab of TAB_ORDER) {
        if (matchesTab(item, tab)) {
          counts[tab] += 1;
        }
      }

      return {
        filePath: item.result.file_path,
        lineStart: item.result.line_start,
        source: item.source,
        symbolGroup: item.symbolGroup,
        bucket: item.bucket,
        html: this.resultHtml(item),
      };
    });

    return { results, counts };
  }

  private guessLanguage(filePath: string): string | undefined {
    const ext = path.extname(filePath).toLowerCase();
    const map: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.mjs': 'javascript',
      '.py': 'python',
      '.rs': 'rust',
      '.go': 'go',
      '.java': 'java',
      '.c': 'c',
      '.cpp': 'cpp',
      '.h': 'c',
      '.hpp': 'cpp',
      '.sh': 'bash',
      '.sql': 'sql',
      '.html': 'xml',
      '.css': 'css',
      '.json': 'json',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.md': 'markdown',
      '.kt': 'kotlin',
      '.swift': 'swift',
      '.php': 'php',
    };

    if (filePath.endsWith('.blade.php')) {
      return 'php';
    }

    return map[ext];
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private highlightLine(line: string, filePath: string): string {
    if (!line) {
      return '&nbsp;';
    }

    const lang = this.guessLanguage(filePath);
    try {
      return lang
        ? hljs.highlight(line, { language: lang, ignoreIllegals: true }).value
        : hljs.highlightAuto(line).value;
    } catch {
      return this.escapeHtml(line);
    }
  }

  private snippetHtml(result: VeraResult): string {
    const lines = result.content.replace(/\r\n/g, '\n').split('\n');
    const preview = lines.slice(0, SNIPPET_LINES);

    const rows = preview
      .map((line, index) => {
        const shortened =
          line.length > SNIPPET_LINE_LIMIT ? `${line.slice(0, SNIPPET_LINE_LIMIT - 3)}...` : line;
        const lineNo = result.line_start + index;
        const highlighted = this.highlightLine(shortened, result.file_path);
        return `
          <div class="code-line">
            <span class="line-no">${lineNo}</span>
            <span class="line-text hljs">${highlighted}</span>
          </div>
        `;
      })
      .join('');

    if (lines.length > SNIPPET_LINES) {
      return `${rows}
        <div class="code-line code-more">
          <span class="line-no">...</span>
          <span class="line-text">...</span>
        </div>
      `;
    }

    return rows;
  }

  private sourceLabel(source: ResultSource): string {
    switch (source) {
      case 'both':
        return 'search+grep';
      case 'search':
        return 'search';
      case 'grep':
        return 'grep';
      default:
        return 'search';
    }
  }

  private symbolLabel(symbolGroup: SymbolGroup): string {
    switch (symbolGroup) {
      case 'class':
        return 'class';
      case 'method':
        return 'method';
      case 'variable':
        return 'variable';
      case 'other':
        return 'code';
      default:
        return 'code';
    }
  }

  private resultHtml(item: RankedResult): string {
    const result = item.result;
    const symbolName = result.symbol_name?.trim();
    const symbolType = result.symbol_type?.trim();
    const title = symbolName || path.basename(result.file_path);
    const lineRange =
      result.line_end !== result.line_start
        ? `${result.line_start}-${result.line_end}`
        : `${result.line_start}`;

    return `
      <button class="result-card bucket-${item.bucket}" data-file="${this.escapeHtml(result.file_path)}" data-line="${result.line_start}">
        <div class="result-head">
          <div class="result-main">
            <span class="result-title">${this.escapeHtml(title)}</span>
            ${symbolType ? `<span class="symbol-type">(${this.escapeHtml(symbolType)})</span>` : ''}
          </div>
          <div class="result-pills">
            <span class="pill kind-${item.symbolGroup}">${this.symbolLabel(item.symbolGroup)}</span>
            <span class="pill source-${item.source}">${this.sourceLabel(item.source)}</span>
          </div>
        </div>
        <div class="result-location">${this.escapeHtml(result.file_path)}:${lineRange}</div>
        <div class="snippet">${this.snippetHtml(result)}</div>
      </button>
    `;
  }
}

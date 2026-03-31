export interface SearchMessage {
  readonly type: 'search';
  readonly query: string;
}

export interface OpenFileMessage {
  readonly type: 'openFile';
  readonly file: string;
  readonly line: number;
}

export function isSearchMessage(msg: unknown): msg is SearchMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as SearchMessage).type === 'search' &&
    typeof (msg as SearchMessage).query === 'string'
  );
}

export function isOpenFileMessage(msg: unknown): msg is OpenFileMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as OpenFileMessage).type === 'openFile' &&
    typeof (msg as OpenFileMessage).file === 'string' &&
    typeof (msg as OpenFileMessage).line === 'number'
  );
}

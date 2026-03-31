export interface SearchMessage {
  readonly type: 'search';
  readonly query: string;
  readonly deepSearch?: boolean;
  readonly docsScope?: boolean;
}

export interface OpenFileMessage {
  readonly type: 'openFile';
  readonly file: string;
  readonly line: number;
}

export function isSearchMessage(msg: unknown): msg is SearchMessage {
  if (typeof msg !== 'object' || msg === null) {
    return false;
  }

  const message = msg as SearchMessage;
  if (message.type !== 'search' || typeof message.query !== 'string') {
    return false;
  }

  if (typeof message.deepSearch !== 'undefined' && typeof message.deepSearch !== 'boolean') {
    return false;
  }

  if (typeof message.docsScope !== 'undefined' && typeof message.docsScope !== 'boolean') {
    return false;
  }

  return true;
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

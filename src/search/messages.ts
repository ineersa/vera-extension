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

export interface IndexMessage {
  readonly type: 'index';
}

export interface LoadConfigMessage {
  readonly type: 'loadConfig';
}

export interface SaveConfigMessage {
  readonly type: 'saveConfig';
  readonly key: string;
  readonly value: string;
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

export function isIndexMessage(msg: unknown): msg is IndexMessage {
  return typeof msg === 'object' && msg !== null && (msg as IndexMessage).type === 'index';
}

export function isLoadConfigMessage(msg: unknown): msg is LoadConfigMessage {
  return typeof msg === 'object' && msg !== null && (msg as LoadConfigMessage).type === 'loadConfig';
}

export function isSaveConfigMessage(msg: unknown): msg is SaveConfigMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as SaveConfigMessage).type === 'saveConfig' &&
    typeof (msg as SaveConfigMessage).key === 'string' &&
    typeof (msg as SaveConfigMessage).value === 'string'
  );
}

import type { CastLine } from './casting';

export const HISTORY_STORAGE_KEY = 'liuyao.cast-history.v1';

export type CastHistoryEntry = {
  id: string;
  createdAt: number;
  lines: CastLine[];
};

export const validStoredLines = (
  value: unknown,
  requireComplete = false,
): value is CastLine[] =>
  Array.isArray(value) &&
  (requireComplete ? value.length === 6 : value.length <= 6) &&
  value.every(
    (line, index) =>
      typeof line === 'object' &&
      line !== null &&
      'id' in line &&
      typeof line.id === 'string' &&
      'number' in line &&
      Number(line.number) === index + 1 &&
      'sum' in line &&
      [6, 7, 8, 9].includes(Number(line.sum)) &&
      'faces' in line &&
      Array.isArray(line.faces) &&
      line.faces.length === 3 &&
      line.faces.every((face: unknown) => face === 'front' || face === 'back'),
  );

export const validStoredHistory = (value: unknown): value is CastHistoryEntry[] =>
  Array.isArray(value) &&
  value.every(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      'id' in entry &&
      typeof entry.id === 'string' &&
      'createdAt' in entry &&
      Number.isFinite(Number(entry.createdAt)) &&
      'lines' in entry &&
      validStoredLines(entry.lines, true),
  );

export const castFingerprint = (lines: CastLine[]) =>
  lines.map((line) => line.id).join('|');

export const createHistoryEntry = (
  lines: CastLine[],
  createdAt = Date.now(),
): CastHistoryEntry => {
  if (!validStoredLines(lines, true)) {
    throw new Error('A history entry requires six complete lines.');
  }

  return {
    id: `cast-${createdAt}-${lines[5].id}`,
    createdAt,
    lines: lines.map((line) => ({ ...line, faces: [...line.faces] })),
  };
};

const pad = (value: number) => String(value).padStart(2, '0');

export const formatHistoryTime = (timestamp: number) => {
  const date = new Date(timestamp);
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

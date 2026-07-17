import type { CoinFace } from './physics';

export type LineKind = 'old-yin' | 'young-yang' | 'young-yin' | 'old-yang';

export type CastLine = {
  id: string;
  number: number;
  faces: [CoinFace, CoinFace, CoinFace];
  sum: 6 | 7 | 8 | 9;
  kind: LineKind;
  label: '老阴' | '少阳' | '少阴' | '老阳';
  moving: boolean;
  yang: boolean;
};

const LINE_META: Record<6 | 7 | 8 | 9, Omit<CastLine, 'id' | 'number' | 'faces' | 'sum'>> = {
  6: { kind: 'old-yin', label: '老阴', moving: true, yang: false },
  7: { kind: 'young-yang', label: '少阳', moving: false, yang: true },
  8: { kind: 'young-yin', label: '少阴', moving: false, yang: false },
  9: { kind: 'old-yang', label: '老阳', moving: true, yang: true },
};

export const castLineFromFaces = (
  faces: [CoinFace, CoinFace, CoinFace],
  number: number,
  id = `${Date.now()}-${number}`,
): CastLine => {
  const sum = faces.reduce<number>((total, face) => total + (face === 'front' ? 3 : 2), 0) as
    | 6
    | 7
    | 8
    | 9;
  return {
    id,
    number,
    faces,
    sum,
    ...LINE_META[sum],
  };
};

export const faceLabel = (face: CoinFace) => (face === 'front' ? '正' : '反');

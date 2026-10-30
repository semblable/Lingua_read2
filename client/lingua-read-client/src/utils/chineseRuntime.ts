import { createChineseSegmenter, type ChineseSegmenter } from './chineseSegmenter';

let current: ChineseSegmenter | null = null;
export const initializeChineseSegmentation = (dictionary: string): void => {
  current = createChineseSegmenter(dictionary);
};
export const getChineseSegmentation = (): ChineseSegmenter => {
  if (!current) throw new Error('Chinese word segmentation has not loaded. Reconnect and reopen this text.');
  return current;
};

import { createThaiSegmenter, type ThaiSegmenter } from './thaiSegmenter';

let current: ThaiSegmenter | null = null;
export const initializeThaiSegmentation = (dictionary: string): void => {
  current = createThaiSegmenter(dictionary);
};
export const getThaiSegmentation = (): ThaiSegmenter => {
  if (!current) throw new Error('Thai word segmentation has not loaded. Reconnect and reopen this text.');
  return current;
};

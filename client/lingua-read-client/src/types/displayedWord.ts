// A "displayed/selected word" is the TextDisplay-side accumulation of fields
// from API word records plus local UI flags. Shape varies; the union below
// names the most-accessed fields without locking out extras.
export type DisplayedWord = {
  wordId?: number | string;
  term?: string;
  translation?: string;
  status?: number;
  isNew?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

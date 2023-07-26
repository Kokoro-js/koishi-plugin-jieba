export interface TaggedWord {
  tag: string
  word: string
}
export interface Keyword {
  keyword: string
  weight: number
}

export interface JiebaApi {
  loadDict(dict: Buffer): void;
  cut(sentence: string | Buffer, hmm?: boolean | undefined | null): string[];
  cutAll(sentence: string | Buffer): string[];
  cutForSearch(sentence: string | Buffer, hmm?: boolean | undefined | null): string[];
  tag(sentence: string | Buffer, hmm?: boolean | undefined | null): Array<TaggedWord>;
  extract(sentence: string | Buffer, topn: number, allowedPos?: string | undefined | null): Array<Keyword>;
  loadTFIDFDict(dict: Buffer): void;
}

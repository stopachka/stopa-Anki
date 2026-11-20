export interface Word {
  id: string;
  traditional: string;
  pinyin: string;
  english: string;
  book: number;
  chapter: number;
}

export interface Book {
  id: string;
  book: number;
  title: string;
  subtitle: string;
  count: number;
  file: string;
  chapters: { chapter: number; count: number }[];
}

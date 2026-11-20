# PAVC vocabulary data

These three JSON files contain the vocabulary used in the reconstructed Anki decks from this chat: Practical Audio-Visual Chinese Books 1–3, from Olle Linge’s archived vocabulary lists. Traditional characters, tone-marked pinyin, English definitions, book and chapter order are preserved from the already reviewed local deck records.

| File | Entries | Chapters |
| --- | ---: | ---: |
| `book-1.json` | 292 | 11 |
| `book-2.json` | 467 | 13 |
| `book-3.json` | 1,028 | 14 |

Total: 1,787 vocabulary entries. Repeated words and different senses remain separate entries; they are not deduplicated by headword.

## Format

Each book is an array of records:

```ts
type VocabularyEntry = {
  id: string;          // Stable book + source-order ID, e.g. "pavc-b1-0001"
  traditional: string;
  pinyin: string;      // Tone marks, as used in the reconstructed decks
  english: string;
  book: number;
  chapter: number;
};
```

`index.json` is an array of book summaries, each with `id`, `book`, `title`, `subtitle`, `count`, `file`, and `chapters` (an array of `{ chapter, count }`).

## Provenance

The local source records are `work/pavc-records.json` (Books 1–2) and `work/pavc-records-book-3.json` (Book 3) in the parent chat workspace. They include the reviewed spelling/definition corrections made when the Anki decks were reconstructed. These app files do not introduce additional content edits or new translations.

Archived source lists:

- Book 1: https://web.archive.org/web/20120824005209id_/http://www.snigel.nu:80/file/chinese/shiyongshitinghuayu1.backup
- Book 2: https://web.archive.org/web/20130916235136id_/http://www.snigel.nu:80/file/chinese/shiyongshitinghuayu2.backup
- Book 3: https://web.archive.org/web/20160703165705id_/http://www.snigel.nu/file/chinese/shiyongshitinghuayu3.backup

The source material is attributed to Olle Linge. No open-source or redistribution license for the vocabulary lists has been established here. These files are prepared for the user’s requested local study prototype; the application code’s license, if any, does not change the vocabulary source’s rights.

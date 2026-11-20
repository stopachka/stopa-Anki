import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Copy the original, unmodified upstream JSON files, only for this app's decks.
// Runtime requests can remain local instead of reaching the default CDN.
const appRoot = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const sourceRoot = dirname(require.resolve('hanzi-writer-data/package.json'));
const sourcePackage = JSON.parse(await readFile(join(sourceRoot, 'package.json'), 'utf8'));
const destination = join(appRoot, 'public/hanzi');
const supplementary = {
  '嚐': 'https://github.com/parsimonhi/animCJK/blob/c63765b150cbd567c71d05cf4a4f8d00b57045c9/graphicsZhHant.txt',
};
const records = (await Promise.all([1, 2, 3].map(async (book) =>
  JSON.parse(await readFile(join(appRoot, `public/data/book-${book}.json`), 'utf8')),
))).flat();
const characters = [...new Set(records.flatMap((record) => [...record.traditional]
  .filter((character) => /\p{Script=Han}/u.test(character))))].sort();

await mkdir(destination, { recursive: true });
const available = [];
const missing = [];
let bytes = 0;
for (const character of characters) {
  let source = join(sourceRoot, `${character}.json`);
  let contents;
  try {
    contents = await readFile(source);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (supplementary[character]) {
      // This one pinned, attributed AnimCJK record is checked into the app.
      // Keep it local and fail clearly if the checked-in file was removed.
      source = join(destination, `${character}.json`);
      contents = await readFile(source);
    } else {
      missing.push(character);
      continue;
    }
  }
  const data = JSON.parse(contents.toString('utf8'));
  if (!Array.isArray(data.strokes) || data.strokes.length === 0 ||
      !Array.isArray(data.medians) || data.medians.length !== data.strokes.length) {
    throw new Error(`Invalid Hanzi Writer stroke data for ${character}`);
  }
  if (source !== join(destination, `${character}.json`)) {
    await copyFile(source, join(destination, `${character}.json`));
  }
  available.push(character);
  bytes += contents.length;
}
await copyFile(join(sourceRoot, 'ARPHICPL.TXT'), join(destination, 'ARPHICPL.TXT'));

const report = {
  source: 'https://github.com/chanind/hanzi-writer-data',
  package: `hanzi-writer-data@${sourcePackage.version}`,
  license: 'Arphic Public License',
  originalData: 'https://github.com/skishore/makemeahanzi',
  supplementary,
  vocabularyEntries: records.length,
  requiredCharacters: characters.length,
  availableCharacters: available.length,
  missingCharacters: missing,
  bytes,
  missingVocabularyEntries: records.filter((record) =>
    [...record.traditional].some((character) => missing.includes(character)),
  ).map(({ id, traditional }) => ({ id, traditional })),
};
await writeFile(join(destination, 'coverage.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(join(destination, 'README.md'), `# Local stroke data

This folder contains ${available.length - Object.keys(supplementary).length} unmodified character JSON files selected from
[hanzi-writer-data ${sourcePackage.version}](https://github.com/chanind/hanzi-writer-data).
The data is derived from [Make Me a Hanzi](https://github.com/skishore/makemeahanzi)
and fonts by Arphic Technology. Copyright (C) 1999 Arphic Technology Co., Ltd.
The data is distributed under the Arphic Public License; see the unmodified
[ARPHICPL.TXT](./ARPHICPL.TXT) supplied alongside it. It is provided without warranty.
The independent Hanzi Writer JavaScript library has its own MIT license.

The additional character 嚐 is extracted from AnimCJK's traditional Chinese
[graphicsZhHant.txt](https://github.com/parsimonhi/animCJK/blob/c63765b150cbd567c71d05cf4a4f8d00b57045c9/graphicsZhHant.txt),
commit c63765b150cbd567c71d05cf4a4f8d00b57045c9. Copyright 2016–2026 FM&SH.
The stroke paths and medians are unchanged; a provenance and modification notice
was added to its JSON on 2026-11-19. AnimCJK graphics are also distributed under
the Arphic Public License. Its upstream notice is in [ANIMCJK-COPYING.txt](./ANIMCJK-COPYING.txt).

These files cover ${available.length} of ${characters.length} unique Han characters
in the three PAVC decks. Full coverage details are in [coverage.json](./coverage.json).
This is upstream Hanzi Writer data. Traditional-character coverage does not imply
that every glyph shape or stroke order exactly follows Taiwan's MOE standard.

Regenerate from the JSON decks after installing dependencies:

\`\`\`sh
node scripts/prepare-hanzi.mjs
\`\`\`

Load each character with a local request such as
\`fetch('/hanzi/' + encodeURIComponent(character) + '.json')\` and provide the
resolved JSON through Hanzi Writer's \`charDataLoader\` option. No runtime CDN
request is needed. No glyph shapes or stroke medians have been modified.
`);
console.log(JSON.stringify(report, null, 2));

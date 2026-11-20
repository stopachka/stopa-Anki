# Local stroke data

This folder contains 1042 unmodified character JSON files selected from
[hanzi-writer-data 2.0.1](https://github.com/chanind/hanzi-writer-data).
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

These files cover 1043 of 1043 unique Han characters
in the three PAVC decks. Full coverage details are in [coverage.json](./coverage.json).
This is upstream Hanzi Writer data. Traditional-character coverage does not imply
that every glyph shape or stroke order exactly follows Taiwan's MOE standard.

Regenerate from the JSON decks after installing dependencies:

```sh
node scripts/prepare-hanzi.mjs
```

Load each character with a local request such as
`fetch('/hanzi/' + encodeURIComponent(character) + '.json')` and provide the
resolved JSON through Hanzi Writer's `charDataLoader` option. No runtime CDN
request is needed. No glyph shapes or stroke medians have been modified.

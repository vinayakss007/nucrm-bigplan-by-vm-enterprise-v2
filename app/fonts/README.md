# Vendored fonts (#2426)

Self-hosted so that `next build` needs no network. Before this directory existed,
`app/layout.tsx` imported `Inter` and `JetBrains_Mono` from `next/font/google`,
which downloads the woff2 files **at compile time** — CI's `Build` job failed on an
unchanged commit (`d17ab596`, run `37583029404`) because that query could not
resolve, and `Dockerfile:59` runs the same `npm run build`, so shipping a release
depended on fonts.gstatic.com being reachable.

These are the files Google serves, unchanged — not re-subsetted or re-encoded.

| File | Family | Weight | Source URL |
| --- | --- | --- | --- |
| `inter-latin-{400,500,600,700,800,900}.woff2` | Inter | static instances | `https://fonts.googleapis.com/css2?family=Inter:wght@<w>` with a woff2-capable User-Agent, `/* latin */` block |
| `jetbrains-mono-latin-{400,500}.woff2` | JetBrains Mono | static instances | `https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@<w>`, same |

One file per weight because a single multi-weight query (`wght@400;500;…`) returned
**byte-identical files for all six weights** (same sha256) — i.e. one variable font
pointed at repeatedly — whereas requesting each weight on its own yields distinct
static instances. Statics were chosen so nothing depends on `fvar`/`wght` axis
behaviour at render time: the weight each `@font-face` declares is the weight the
file is.

To refresh (do not do this casually — the weights and the `--font-*` variable names
are pinned by `tests/unit/hermetic-font-build-2426.test.ts`):

```sh
UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
for fam in "Inter:inter" "JetBrains+Mono:jetbrains-mono"; do
  q=${fam%%:*}; slug=${fam##*:}
  for w in 400 500 600 700 800 900; do
    case $slug in jetbrains-mono) [ "$w" -gt 500 ] && continue;; esac
    url=$(curl -s -A "$UA" "https://fonts.googleapis.com/css2?family=$q:wght@$w&display=swap" \
          | awk '/\/\* latin \*\//{f=1} f&&/url\(/{print; exit}' | sed 's/.*url(\([^)]*\)).*/\1/')
    curl -s -A "$UA" -o "app/fonts/$slug-latin-$w.woff2" "$url"
  done
done
```

## License

Both families are licensed under the **SIL Open Font License 1.1**, which permits
self-hosting, embedding and redistribution in source and binary form provided the
font files are not sold by themselves and the notice below accompanies them.

- Inter — Copyright (c) 2020 The Inter Project Authors, <https://github.com/rsms/inter>
- JetBrains Mono — Copyright (c) 2020 The JetBrains Mono Project Authors,
  <https://github.com/JetBrains/JetBrainsMono>

> This Font Software is licensed under the SIL Open Font License, Version 1.1.
> The full text is at <https://openfontlicense.org/>. The font files in this
> directory carry the same license, and the OFL permits their use, study,
> modification and redistribution as long as modified versions are not released
> under the name "Inter" or "JetBrains Mono".

These are unmodified upstream binaries used as web fonts in NuCRM's own interface,
which is exactly the use the OFL grants.

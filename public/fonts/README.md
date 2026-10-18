# Fonts

Every face is self-hosted under the SIL Open Font License 1.1; the licence text sits beside each one.

| Face | Use | Files | Licence | Upstream |
| --- | --- | --- | --- | --- |
| Figtree (variable, 300–900) | Headings and the "Lodge" wordmark | `figtree/` Latin and Latin Extended WOFF2 | `figtree/LICENSE.txt` | https://github.com/erikdkennedy/figtree |
| Inter (variable, 100–900) | Body text, cards and the app | `inter/` Latin and Latin Extended WOFF2 | `inter/LICENSE.txt` | https://github.com/rsms/inter |
| JetBrains Mono (variable) | Commands and code | `jetbrains-mono/` Latin WOFF2 | `jetbrains-mono/LICENSE.txt` | https://github.com/JetBrains/JetBrainsMono |
| Outfit | Kept as Base's copy (`base-copies.json`); Lodge no longer sets it | `outfit/` | `outfit/LICENSE.txt` | https://github.com/Outfitio/Outfit-Fonts |

The WOFF2 subsets come from Fontsource's distributions. `fonts.css` declares the faces once; pages link it
(the theme imports it for Base's frames) and preload only the Latin Figtree and Inter files.

`Inter Fallback` and `Figtree Fallback` are local Arial faces sized to the measured advance widths of A-Z, a-z
and 0-9 (Inter 400 104.57%, Inter 600 102.90%, Figtree 900 101.20% of Arial) with each face's own ascent and
descent divided by that size-adjust, so text barely moves when the web fonts arrive. Recalculate them when a
face changes.

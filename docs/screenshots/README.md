# Screenshots

The README embeds five images from this directory. **They are the one thing not
generated automatically** — capture them once, with the app running locally, and
the README is complete.

## Required filenames

| File | What to capture |
| --- | --- |
| `login.png` | `/login` — split screen, live counters, particle field |
| `dashboard.png` | `/dashboard` — KPI row, repeat-participants graph, trend |
| `drawer.png` | `/transactions` → click a **CRITICAL** row → the detail drawer with the gauge and evidence ledger |
| `radar.png` | `/transactions` in **Radar** view — the scatter with the top-right cluster |
| `live-feed.png` | `/live-feed` mid-run — start a replay at 3/sec, capture while rows are arriving |

## How

```bash
./dev.sh                       # start everything
open http://localhost:5173
```

On macOS, `Cmd + Shift + 4` then `Space` captures a whole window. Save each into
this directory with the exact filename above.

Tips that make these look considered rather than incidental:

- Use a **wide window** (~1440px) so the sidebar and content both breathe.
- For `drawer.png`, pick a genuinely critical transaction — sort by amount
  descending in List view and open the largest.
- For `radar.png`, clear all filters first so the full distribution shows.
- For `live-feed.png`, capture a few seconds in, once several rows have landed
  and a critical one is still glowing.
- Crop out your browser chrome and bookmarks bar.

## Optional

`command-palette.png` — if you add the Cmd+K palette later, capture it open over
the dashboard and add it to the README's feature list.

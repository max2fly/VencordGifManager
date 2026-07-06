# GifManager

A local-first gif manager for Vencord. Backs up your favorited gifs to disk so they survive
Tenor/Discord-CDN deletion, organizes them into collections, and recovers gifs whose original
source has died. Forked from and built on top of <https://github.com/Syncxv/vc-gif-collections>.

> Desktop only (Vesktop / Discord desktop). It uses a native helper to store files on disk; the
> code is structured so an IndexedDB backend could be added for the web build later.

## What it does

- **Local backup.** Every favorited media is downloaded to `…/<userData>/VencordGifManager/gifs`
  (e.g. `…\vesktop\VencordGifManager\gifs`). New favorites cache immediately; existing ones
  backfill as the picker renders them.
- **Renders from disk.** The gif picker shows your favorites/collections from the local cache, so
  it doesn't re-hit the network every time.
- **Collections.** Right-click a gif → *Add To Collection*. The picker is trimmed to **Favorites +
  your collections** (no Trending/suggested). A gif added to a collection is hidden from the
  Favorites grid but stays a native favorite — so disabling the plugin shows everything again,
  while allowing for easy sorting of the favorites. Nothing is lost if the plugin is removed.
- **Durable sending / recovery.** For CDN gif whose original was **deleted**, clicking on the gif
  (or right-click → *Recover From Backup*) re-uploads your local copy as a fresh attachment
  (transcoding video → gif so it renders inline), then *rebases* the gif onto the new working URL
  — updating the collection in place andswapping the native favorite, so it keeps working even
  without the plugin.
- **Health check.** Discord-CDN gifs are re-checked at most once per 24h; a confirmed deletion
  (`404 NoSuchKey`) marks the gif so the next click recovers it. Right-click → *Force-Forget CDN*
  lets you trigger/clear this manually. Added benefit of performance improvement due only loading
  gifs that are on the screen rather than all like the native client, as well as removes the api
  hammering the native client does on each open of hte gif list.
- **Trashcan.** Cached gifs you've unfavorited (and aren't in a collection) show in a **Trash**
  category instead of being orphaned. Right-click an item to **Restore To Favorites**, **Send From
  Backup**, or **Delete Permanently**. Settings → **Empty Trashcan** purges it and sweeps any
  leaked on-disk files.
- **Import / Export.** Collection structure can be exported/imported as JSON (the `gifs` folder is
  the byte-level backup).
- **Favoriting Images and Videos** Can natively favorite all media types rather than purely gifs,
  using the native discord fucntionality, so its kept cross device
- **Gif editor** Native media editor to allow adding meme captions without leaving the app.

## Recommended companion

Enable the built-in **GifPaste** plugin if you'd rather clicking a gif insert its link into the
chat box than send it immediately. GifManager does **not** patch GifPaste and works alongside it —
it only takes over the click for gifs whose source was deleted (to recover from your backup).

## Limitations

- A gif whose original was deleted **before** the plugin ever cached it can't be recovered — there
  are no bytes to back up. The plugin can only archive what's still alive when it first sees it.
- Native-favorite manipulation (the rebase favorite-swap) drives Discord's internal Frecency proto;
  it's keyed on stable identifiers but could need updating if Discord reworks gif favorites.
- The plugin downloads and backup any media you favorite, so if you favorite massive files, it will
  use a significant amount of storage

/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2024 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import type { PluginNative } from "@utils/types";

import * as CollectionManager from "../CollectionManager";
import * as GifLibrary from "../GifLibrary";
import { dropObjectUrl } from "../gifCache";
import { GifRecord } from "../types";
import { getGifKey, hashKey } from "./gifKey";

const Native = VencordNative.pluginHelpers.GifManager as PluginNative<typeof import("../native")>;

// The trashcan is computed, not stored: a cached gif that is neither favorited nor in any
// collection is "in the trash". We snapshot the favorite keys whenever the favorites view
// renders (the picker's default view, so this is populated almost immediately).
let favKeys = new Set<string>();
let favoritesSeen = false;

export function setFavoriteKeys(keys: Set<string>) {
    favKeys = keys;
    favoritesSeen = true;
}

function collectionKeys(): Set<string> {
    const set = new Set<string>();
    for (const c of CollectionManager.cache_collections)
        for (const g of c.gifs) set.add(getGifKey(g.url));
    return set;
}

/** Cached gifs no longer reachable from favorites or any collection. Empty until we've seen the favorites list once. */
export function getOrphans(): GifRecord[] {
    if (!favoritesSeen) return [];
    const coll = collectionKeys();
    return Object.values(GifLibrary.cache_library)
        .filter(r => r.localExt && !favKeys.has(r.key) && !coll.has(r.key));
}

export function isOrphan(key: string): boolean {
    return getOrphans().some(r => r.key === key);
}

/** Permanently delete a trashed gif: its on-disk file, its object URL, and its library record. */
export async function deleteOrphan(record: GifRecord): Promise<void> {
    if (record.localExt) await Native.deleteGif(hashKey(record.key), record.localExt).catch(() => { });
    dropObjectUrl(record.key);
    await GifLibrary.removeRecord(record.key);
}

/** Empty the whole trashcan. Returns how many were removed. */
export async function purgeTrash(): Promise<number> {
    const orphans = getOrphans();
    for (const r of orphans) await deleteOrphan(r);
    return orphans.length;
}

/**
 * Delete on-disk cache files that no longer have ANY library record (true leaks, e.g. from
 * old rebase duplicates) — manual cleanup is impractical, so this does it safely. Returns count.
 */
export async function sweepLeakedFiles(): Promise<number> {
    const files = await Native.listCached();
    const valid = new Set(Object.keys(GifLibrary.cache_library).map(k => hashKey(k)));
    let removed = 0;
    for (const f of files) {
        const dot = f.lastIndexOf(".");
        const id = dot >= 0 ? f.slice(0, dot) : f;
        const ext = dot >= 0 ? f.slice(dot + 1) : "";
        if (id && ext && !valid.has(id)) {
            await Native.deleteGif(id, ext).catch(() => { });
            removed++;
        }
    }
    return removed;
}

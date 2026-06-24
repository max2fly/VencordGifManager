/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
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

import { DataStore } from "@api/index";

import { Gif, GifRecord, GifStatus } from "./types";
import { getFormat } from "./utils/getFormat";
import { classifyHost, getGifKey } from "./utils/gifKey";

export const DATA_LIBRARY_NAME = "gif-collections-library";

// `cache_library` is the authoritative in-memory state. ALL mutations modify it synchronously
// and then schedule a single debounced persist. This is critical: the previous design re-read
// from DataStore, mutated, and wrote back per call — when many ran concurrently (e.g. dozens of
// blob-gif upserts firing at once) the writes clobbered each other and records silently vanished.
// A single debounced writer means there's never a concurrent read-modify-write race.
export let cache_library: Record<string, GifRecord> = {};

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist(): void {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
        persistTimer = null;
        DataStore.set(DATA_LIBRARY_NAME, cache_library).catch(e => console.error("[GifManager] library persist failed", e));
    }, 400);
}

export async function refreshLibrary(): Promise<void> {
    cache_library = (await DataStore.get<Record<string, GifRecord>>(DATA_LIBRARY_NAME)) ?? {};
}

export function getRecord(key: string): GifRecord | undefined {
    return cache_library[key];
}

export function upsertFromGif(gif: Gif): GifRecord {
    const key = getGifKey(gif.url);
    let record = cache_library[key];
    if (!record) {
        record = {
            key,
            url: gif.url,
            src: getGifKey(gif.src),
            host: classifyHost(gif.url),
            width: gif.width,
            height: gif.height,
            format: getFormat(gif.src),
            localExt: null,
            status: "ok",
            lastCheckedAt: 0
        };
        cache_library[key] = record;
        schedulePersist();
    }
    return record;
}

export function setLocalExt(key: string, ext: string | null): void {
    if (cache_library[key]) { cache_library[key].localExt = ext; schedulePersist(); }
}

export function setStatus(key: string, status: GifStatus, reuploadedUrl?: string): void {
    const rec = cache_library[key];
    if (!rec) return;
    rec.status = status;
    if (reuploadedUrl) { rec.reuploadedUrl = reuploadedUrl; rec.url = reuploadedUrl; }
    schedulePersist();
}

export function touchChecked(key: string): void {
    if (cache_library[key]) { cache_library[key].lastCheckedAt = Date.now(); schedulePersist(); }
}

export function removeRecord(key: string): void {
    if (cache_library[key]) { delete cache_library[key]; schedulePersist(); }
}

// Post-recovery rebase: insert a fully-formed record (keyed by record.key) and drop the old one.
export function rebaseRecord(oldKey: string, record: GifRecord): void {
    delete cache_library[oldKey];
    cache_library[record.key] = record;
    schedulePersist();
}

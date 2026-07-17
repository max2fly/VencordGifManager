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

import * as GifLibrary from "../GifLibrary";
import { ensureCached, fetchOutcome, getObjectUrl, getObjectUrlSync } from "../gifCache";
import { Gif } from "../types";
import { classifyFetchResult, GifHost } from "./health";
import { getGifKey } from "./gifKey";

// A tiny concurrency-limited runner. Used for two distinct workloads so a large
// favorites list can't fire everything at once.
function makeRunner(maxConcurrent: number) {
    const q: (() => Promise<void>)[] = [];
    let active = 0;
    const pump = () => {
        while (active < maxConcurrent && q.length) {
            const job = q.shift()!;
            active++;
            job().finally(() => { active--; pump(); });
        }
    };
    return (job: () => Promise<void>) => { q.push(job); pump(); };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Network downloads: expensive + remote → low concurrency, spaced, to avoid mass-requesting APIs.
const DOWNLOAD_CONCURRENCY = 3;
const DOWNLOAD_SPACING_MS = 150;
const runDownload = makeRunner(DOWNLOAD_CONCURRENCY);
const requested = new Set<string>();   // network fetches kicked this session

// Hydration: reading an already-cached file from disk into an object URL. Cheaper than
// network but still IPC + a Blob per gif, so cap it so first-open doesn't read ~200 files
// at once (which froze the picker until everything was in memory).
const HYDRATE_CONCURRENCY = 6;
const runHydrate = makeRunner(HYDRATE_CONCURRENCY);
const hydrating = new Set<string>();   // disk reads in flight this session

// Health checks: remote existence probes for Discord-CDN gifs (whose urls expire/delete).
const DAY_MS = 24 * 60 * 60 * 1000;
const runHealth = makeRunner(3);
const checking = new Set<string>();

// Fresh signed CDN urls captured at render time, keyed by gif key. Our render swaps a cached
// favorite's `src` to a local blob:, so by click time the clicked object no longer carries
// Discord's signed url and our stored record url is the bare (always-404) one. Stash the fresh
// signed url here so the send-time probe has a live url to check.
const freshSignedUrls = new Map<string, string>();

export function rememberFreshUrl(key: string, url: string | undefined): void {
    if (url && !url.startsWith("blob:")) freshSignedUrls.set(key, url);
}

/**
 * Send-time existence probe for a CDN gif, reusing the fresh signed url captured at render.
 * Returns the raw verdict; callers decide what to do with it. Never throws (transient on error).
 */
export async function probeFreshUrl(key: string, fallbackUrl: string, host: GifHost): Promise<"ok" | "unavailable" | "transient"> {
    const url = freshSignedUrls.get(key) ?? fallbackUrl;
    try {
        return classifyFetchResult(await fetchOutcome(url), host);
    } catch {
        return "transient";
    }
}

/**
 * Opportunistic 24h health check for a saved gif, using the FRESH url Discord provides at render
 * time (our stored url's signature, if any, has long expired). Marks the record "gone" when the
 * source is unavailable (any HTTP error — deleted attachment, dead external host, 500, …) and back
 * to "ok" if it serves again. Host-agnostic: any host can go down. Fire-and-forget.
 */
export function healthCheck(gif: Gif): void {
    if (!gif?.url) return;
    const key = getGifKey(gif.url);
    const rec = GifLibrary.getRecord(key);
    if (!rec) return;
    if (Date.now() - rec.lastCheckedAt < DAY_MS) return;
    if (checking.has(key)) return;
    checking.add(key);
    runHealth(async () => {
        try {
            const verdict = classifyFetchResult(await fetchOutcome(gif.src || gif.url), rec.host);
            if (verdict === "unavailable") await GifLibrary.setStatus(key, "gone");
            else if (verdict === "ok" && rec.status === "gone") await GifLibrary.setStatus(key, "ok");
            if (verdict !== "transient") await GifLibrary.touchChecked(key);
        } catch {
            // transient/unknown — leave for the next render pass
        } finally {
            checking.delete(key);
        }
    });
}

/**
 * Ensure a gif (favorite OR collection member) is available as a local object URL.
 * Resolves true only when it became NEWLY available (caller may then forceUpdate so the
 * picker swaps the network src for the local one). Idempotent + guarded + throttled.
 */
export function cacheGif(gif: Gif): Promise<boolean> {
    if (!gif?.url) return Promise.resolve(false);
    const key = getGifKey(gif.url);
    const existing = GifLibrary.getRecord(key);

    // Already cached on disk → hydrate its object URL (throttled), don't re-download.
    if (existing?.localExt) {
        if (getObjectUrlSync(key)) return Promise.resolve(false);   // already in memory
        if (hydrating.has(key)) return Promise.resolve(false);      // disk read in flight
        hydrating.add(key);
        return new Promise<boolean>(resolve => {
            runHydrate(async () => {
                let url: string | null = null;
                try { url = await getObjectUrl(existing); } catch { /* fall through to heal */ }
                hydrating.delete(key);
                if (url) return resolve(true);
                // Record claims a local file but it's gone — self-heal: clear localExt and
                // re-download. (Prevents a gif being permanently stuck blank with no retry.)
                GifLibrary.setLocalExt(key, null);
                resolve(await cacheGif(gif));
            });
        });
    }

    // Not cached yet → download, save, then hydrate.
    if (requested.has(key)) return Promise.resolve(false);
    requested.add(key);

    // blob: srcs are renderer-local AND ephemeral (Discord revokes them when the gif scrolls
    // out of view), so capture them IMMEDIATELY — not via the spaced network queue, which could
    // let the blob revoke before the job runs. Real urls go through the throttle as before.
    const isBlob = (gif.src ?? "").startsWith("blob:");
    const doCache = async () => {
        try {
            if (!isBlob) await sleep(DOWNLOAD_SPACING_MS);   // spacing only matters for real network requests
            const record = await GifLibrary.upsertFromGif(gif);
            const ext = await Promise.race([
                ensureCached(record, gif.src || gif.url),
                new Promise<null>(r => setTimeout(() => r(null), 25000))   // never wedge on a hung fetch
            ]);
            if (!ext) { requested.delete(key); return false; }   // transient — allow retry
            await GifLibrary.setLocalExt(key, ext);
            await getObjectUrl({ ...record, localExt: ext });
            return true;
        } catch {
            requested.delete(key);
            return false;
        }
    };

    if (isBlob) return doCache();
    return new Promise<boolean>(resolve => { runDownload(() => doCache().then(resolve)); });
}

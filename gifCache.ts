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

import type { PluginNative } from "@utils/types";

import { EXT_MIME } from "./constants";
import { GifRecord } from "./types";
import { getUrlExtension } from "./utils/getUrlExtension";
import { hashKey } from "./utils/gifKey";
import { sniffExt } from "./utils/sniff";

const Native = VencordNative.pluginHelpers.GifManager as PluginNative<typeof import("./native")>;

const objectUrls = new Map<string, string>(); // key -> blob: url

/** Content-type -> extension. Null when the header is unhelpful (octet-stream, html, …). */
function extFromMime(mime: string): string | null {
    if (mime.includes("gif")) return "gif";
    if (mime.includes("quicktime")) return "mov"; // .mov ships as video/quicktime, matching no other token
    if (mime.includes("mp4")) return "mp4";
    if (mime.includes("webm")) return "webm";
    if (mime.includes("avif")) return "avif";
    if (mime.includes("png")) return "png";
    if (mime.includes("webp")) return "webp";
    if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
    return null;
}

// Chromium's <video> won't commit to video/quicktime, but a .mov IS ISO-BMFF — the same container
// family as mp4 — so it decodes fine when labelled as one. Only the Blob's label is adjusted; the
// bytes and the on-disk .mov extension are untouched.
const BLOB_MIME: Record<string, string> = { ...EXT_MIME, mov: "video/mp4" };

export async function ensureCached(record: GifRecord, signedUrl: string): Promise<string | null> {
    const fileId = hashKey(record.key);
    if (record.localExt) {
        const existing = await Native.readGif(fileId, record.localExt);
        if (existing) return record.localExt;
    }

    let status: number, mime: string, bytes: Uint8Array | null;
    if (signedUrl.startsWith("blob:")) {
        // Discord sometimes hands us a renderer-local blob: object URL (e.g. a video favorite it's
        // already loaded). The main process can't fetch those — but the renderer can, and the blob
        // IS the gif's bytes, so capture them here directly.
        try {
            const r = await fetch(signedUrl);
            bytes = r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
            status = r.status;
            mime = r.headers.get("content-type")?.split(";")[0].trim() ?? "";
        } catch {
            status = -1; mime = ""; bytes = null;
        }
    } else {
        const res = await Native.fetchUrl(signedUrl);
        status = res.status; mime = res.mime; bytes = res.bytes;
    }

    if (status < 200 || status >= 300 || !bytes) {
        console.warn(`[GifManager] cache fetch failed (status ${status})`, signedUrl.slice(0, 100));
        return null;
    }
    // Unhelpful content-type (octet-stream, an api redirect's text/html, …): the BYTES are
    // authoritative, so sniff their magic number before falling back to guessing from the url.
    const ext = extFromMime(mime)
        ?? sniffExt(bytes)
        ?? (getUrlExtension(record.url) ?? getUrlExtension(signedUrl) ?? "").toLowerCase();

    // Never persist a file we can't name — an unrenderable blob is worse than no cache, and
    // skipping leaves the item retryable on the next pass.
    if (!(ext in EXT_MIME)) {
        console.warn(`[GifManager] uncacheable media (mime "${mime}", ext "${ext}")`, signedUrl.slice(0, 100));
        return null;
    }

    await Native.saveGif(fileId, bytes, ext);
    return ext;
}

export async function getObjectUrl(record: GifRecord): Promise<string | null> {
    if (objectUrls.has(record.key)) return objectUrls.get(record.key)!;
    if (!record.localExt) return null;
    const bytes = await Native.readGif(hashKey(record.key), record.localExt);
    if (!bytes) return null;
    const url = URL.createObjectURL(new Blob([bytes], { type: BLOB_MIME[record.localExt] ?? "" }));
    objectUrls.set(record.key, url);
    return url;
}

export function dropObjectUrl(key: string): void {
    const url = objectUrls.get(key);
    if (url) { URL.revokeObjectURL(url); objectUrls.delete(key); }
}

export function revokeAll(): void {
    for (const url of objectUrls.values()) URL.revokeObjectURL(url);
    objectUrls.clear();
}

export function fetchOutcome(url: string) {
    return Native.fetchUrl(url).then(r => ({ status: r.status, bodyText: r.bodyText ?? undefined }));
}

export function getObjectUrlSync(key: string): string | undefined {
    return objectUrls.get(key);
}

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
import { findByPropsLazy } from "@webpack";
import { SelectedChannelStore, Toasts } from "@webpack/common";

import { CLOUD_UPLOAD_PLATFORM_WEB, DRAFT_TYPE_CHANNEL_MESSAGE, EXT_MIME } from "../constants";
import * as GifLibrary from "../GifLibrary";
import { decodeFrames } from "./frames";
import { getGifKey, hashKey } from "./gifKey";
import { getUrlExtension } from "./getUrlExtension";
import { sniffExt } from "./sniff";
import { encodeGif } from "./transcode";

const UploadAttachmentStore = findByPropsLazy("addFiles");
const Native = VencordNative.pluginHelpers.GifManager as PluginNative<typeof import("../native")>;

function toast(message: string, type: number) {
    Toasts.show({ message, type, id: Toasts.genId(), options: { duration: 3000, position: Toasts.Position.BOTTOM } });
}

/**
 * Stage a blob into a channel's composer as a pending attachment.
 * `channelId` defaults to the currently-selected channel; callers that captured a
 * channel earlier (e.g. recoverGif before a multi-second transcode) pass it explicitly
 * so a mid-flight channel switch can't retarget the staged file.
 */
export function stageBlob(blob: Blob, filename: string, channelId?: string): boolean {
    const cid = channelId ?? SelectedChannelStore.getChannelId();
    if (!cid) { toast("Open a channel first", Toasts.Type.FAILURE); return false; }
    if (!UploadAttachmentStore?.addFiles) { toast("Upload module not ready — try again", Toasts.Type.FAILURE); return false; }
    const file = new File([blob], filename, { type: blob.type });
    UploadAttachmentStore.addFiles({
        channelId: cid,
        draftType: DRAFT_TYPE_CHANNEL_MESSAGE,
        files: [{ file, platform: CLOUD_UPLOAD_PLATFORM_WEB }]
    });
    return true;
}

/**
 * Quick convert to GIF and stage into the composer. Unified through decode → encode so it works for
 * BOTH videos (→ animated gif) and static images (→ a 1-frame gif) — the image case is the "paste
 * this image as a gif" action. (Gifs never reach here; the menu hides Convert for them.)
 */
export async function convertAndStage(blob: Blob, ext: string): Promise<void> {
    toast("Converting to gif…", Toasts.Type.MESSAGE);
    try {
        const { frames, delays, w, h } = await decodeFrames(blob, ext);
        const gif = encodeGif(frames, delays, w, h);
        if (stageBlob(gif, "converted.gif")) toast("Added to your message", Toasts.Type.SUCCESS);
    } catch (e) {
        console.error("[GifManager] convert to gif failed", e);
        toast("Couldn't convert to gif", Toasts.Type.FAILURE);
    }
}

/**
 * Load a picker/chat item's bytes: prefer the local backup, else fetch the displayed media.
 * Returns null on any failure so every caller's single `if (!src)` guard covers it.
 *
 * For an uncached item (e.g. a gif from the search bar) we try each candidate url — the on-screen
 * `src` FIRST (a search result's src is usually a working proxy) then the item `url` — and each via
 * the renderer (browser origin: works for the Discord/tenor CDNs that allow CORS) then the main
 * process (no CORS, but some hosts 403 a headerless server fetch). We accept only bytes that sniff
 * as real media, so a 403 HTML page never becomes a broken "gif".
 */
export async function loadSource(item: { url?: string; src?: string }): Promise<{ blob: Blob; ext: string } | null> {
    const url = item.url ?? item.src;
    if (!url) return null;
    try {
        const rec = GifLibrary.getRecord(getGifKey(url));
        if (rec?.localExt) {
            const raw = await Native.readGif(hashKey(rec.key), rec.localExt);
            if (raw) return pack(raw, rec.localExt, url);
        }
        const candidates = [item.src, url].filter((v, i, a): v is string => !!v && a.indexOf(v) === i);
        for (const candidate of candidates) {
            const raw = await fetchMediaBytes(candidate);
            if (raw && sniffExt(raw)) return pack(raw, null, url);
        }
        return null;
    } catch (e) {
        console.error("[GifManager] loadSource failed", e);
        return null;
    }
}

// Fetch a url's bytes: renderer fetch first (has the Discord origin — works for CDNs that allow
// CORS and is the only way to read blob:/data:), main-process fetch as a fallback (no CORS).
async function fetchMediaBytes(u: string): Promise<Uint8Array | null> {
    try {
        const r = await fetch(u);
        if (r.ok) { const b = new Uint8Array(await r.arrayBuffer()); if (b.length) return b; }
    } catch { /* CORS / network — fall through to the main process */ }
    if (u.startsWith("blob:") || u.startsWith("data:")) return null; // main process can't read these
    const res = await Native.fetchUrl(u);
    return res?.bytes ?? null;
}

/**
 * Build a typed blob whose extension is AUTHORITATIVE. Magic-byte sniff wins (content can't lie —
 * this is what stops a video favorite that arrives as a typeless blob: from being mislabeled "gif"
 * and rendered in an <img>); then the caller's hint (localExt / mime-derived), the url extension,
 * and finally a gif fallback. The blob's type is set from the resolved ext so the <video>/<img>
 * choice and the decoder both agree.
 */
function pack(raw: Uint8Array, hint: string | null, url: string): { blob: Blob; ext: string } {
    const ext = sniffExt(raw) ?? hint ?? getUrlExtension(url) ?? "gif";
    return { blob: new Blob([raw], { type: EXT_MIME[ext] ?? "application/octet-stream" }), ext };
}

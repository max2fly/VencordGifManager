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

import { VIDEO_EXTS } from "../constants";
import { getUrlExtension } from "./getUrlExtension";
import { unwrapChain } from "./unwrapUrl";

export type FormatClass = "gif" | "img" | "vid";

// Hosts that serve "gifs" Discord renders inline as animated. The container is usually mp4/webp/webm/avif,
// so classification must key off the HOST, not the file extension — a Tenor "gif" is really an mp4, and
// vxtwitter's gifconvert hands back an animated .avif of a twitter gif.
const GIF_HOSTS = ["tenor", "giphy", "gfycat", "redgifs", "klipy", "gifer", "gifdb", "imgflip", "gifconvert"];

// Containers Discord renders as a still image. Listed explicitly so that an *unrecognised* extension
// counts as "no signal" and classification falls through to the wrapped url instead of guessing "img".
const IMAGE_EXTS = ["png", "jpg", "jpeg", "jfif", "webp", "avif", "apng", "bmp", "heic", "heif", "tif", "tiff", "svg"];

function safeHost(url: string): string {
    try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}

/** True when the url renders inline as an animated gif: a gif host, a gif.* subdomain, or a .gif file. */
export function isGifUrl(url: string): boolean {
    const host = safeHost(url);
    if (GIF_HOSTS.some(h => host.includes(h))) return true;
    if (host.startsWith("gif.") || host.includes(".gif.")) return true;
    return (getUrlExtension(url) ?? "").toLowerCase() === "gif";
}

/**
 * Classify what a media item will SEND / APPEAR as — for the picker outline and convert gating —
 * by RENDER BEHAVIOUR, not raw container:
 *   - gif hosts (tenor/klipy/giphy/…) and real .gif files render inline animated  → "gif" (no outline)
 *   - real video files (mp4/mov/webm/… NOT on a gif host) send as a video player  → "vid"  (blue)
 *   - everything else is a static image                                           → "img"  (green)
 * Wrapper urls (Discord's image proxy, converter services with a `?url=` source) carry no signal of
 * their own, so each layer is peeled until one answers — the outermost answer wins, since that is the
 * resource actually fetched. `localExt` is the last resort, for an extension-less CDN url.
 */
export function classifyMedia(url: string, localExt?: string | null): FormatClass {
    for (const candidate of unwrapChain(url)) {
        if (isGifUrl(candidate)) return "gif";
        const e = (getUrlExtension(candidate) ?? "").toLowerCase();
        if (VIDEO_EXTS.includes(e)) return "vid";
        if (IMAGE_EXTS.includes(e)) return "img";
    }
    const e = (localExt ?? "").toLowerCase();
    if (e === "gif") return "gif";
    if (VIDEO_EXTS.includes(e)) return "vid";
    return "img";
}

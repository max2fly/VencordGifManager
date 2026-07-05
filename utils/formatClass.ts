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

export type FormatClass = "gif" | "img" | "vid";

// Hosts that serve "gifs" Discord renders inline as animated. The container is usually mp4/webp/webm,
// so classification must key off the HOST, not the file extension — a Tenor "gif" is really an mp4.
const GIF_HOSTS = ["tenor", "giphy", "gfycat", "redgifs", "klipy", "gifer", "gifdb", "imgflip"];

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
 * `localExt` is consulted only when the url itself carries no extension (e.g. an extension-less CDN url).
 */
export function classifyMedia(url: string, localExt?: string | null): FormatClass {
    if (isGifUrl(url)) return "gif";
    const e = ((getUrlExtension(url) ?? localExt) ?? "").toLowerCase();
    if (e === "gif") return "gif";
    if (VIDEO_EXTS.includes(e)) return "vid";
    return "img";
}

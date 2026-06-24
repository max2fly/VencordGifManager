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

export function getGifKey(url: string): string {
    try {
        const u = new URL(url);
        const host = u.hostname.toLowerCase();
        if (host === "cdn.discordapp.com" || host === "media.discordapp.net") {
            // Discord CDN: the path identifies the attachment. ALL query params are
            // volatile — signature (ex/is/hm) and rendering hints (width/height/quality)
            // — so the same gif at different sizes must map to one key. Drop the query.
            u.search = "";
        } else {
            // Other hosts may carry identity in the query (e.g. proxy URLs like
            // ".../convert.avif?url=<the actual gif>"), so keep it; only remove
            // Discord's signature params if they happen to be present.
            for (const p of ["ex", "is", "hm"]) u.searchParams.delete(p);
        }
        return u.href;
    } catch {
        return url;
    }
}

export function classifyHost(url: string): "tenor" | "cdn" | "other" {
    const u = url.toLowerCase();
    if (u.includes("tenor.com")) return "tenor";
    if (u.includes("cdn.discordapp.com")) return "cdn";
    return "other";
}

// cyrb53 — fast, deterministic, dependency-free
export function hashKey(key: string): string {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < key.length; i++) {
        const ch = key.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
    return n.toString(16);
}

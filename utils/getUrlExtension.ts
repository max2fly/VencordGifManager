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

export function getUrlExtension(url: string) {
    try {
        // blob: object URLs have no meaningful extension and break the prefix hack below
        if (url.startsWith("blob:")) return undefined;
        // tennor stuff is like //media.tenor/blah/blah
        if (!url.startsWith("https:")) url = "https:" + url;
        const path = new URL(url).pathname;
        // Only the LAST path segment can carry the extension. Scanning the whole path finds dots
        // from earlier segments — Discord's proxy embeds the origin host in the path
        // (/external/<sig>/https/api.fxtwitter.com/2/go), which yielded a bogus "com/2/go".
        const segment = path.slice(path.lastIndexOf("/") + 1);
        const dot = segment.lastIndexOf(".");
        if (dot === -1) return undefined;
        const ext = segment.slice(dot + 1);
        return /^[a-z0-9]+$/i.test(ext) ? ext : undefined;
    } catch {
        return undefined;
    }
}

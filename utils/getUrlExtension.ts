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

/** A real container extension is short and alphanumeric — anything else is a false positive. */
function isExt(candidate: string): boolean {
    return /^[a-z0-9]{2,5}$/i.test(candidate);
}

export function getUrlExtension(url: string) {
    try {
        // blob: object URLs have no meaningful extension and break the prefix hack below
        if (url.startsWith("blob:")) return undefined;
        // tennor stuff is like //media.tenor/blah/blah
        if (!url.startsWith("https:")) url = "https:" + url;
        const { pathname, searchParams } = new URL(url);
        // Only the LAST path segment can carry the extension. Scanning the whole path finds dots
        // from earlier segments — Discord's proxy embeds the origin host in the path
        // (/external/<sig>/https/api.fxtwitter.com/2/go), which yielded a bogus "com/2/go".
        // Twitter then appends a size variant AFTER the extension (…/HMn0.jpg:large), so cut at ":".
        const segment = pathname.slice(pathname.lastIndexOf("/") + 1).split(":")[0];
        const dot = segment.lastIndexOf(".");
        const ext = dot === -1 ? undefined : segment.slice(dot + 1);
        if (ext && isExt(ext)) return ext;

        // Extension-less path: some hosts (pbs.twimg.com/media/<id>?format=jpg&name=small) name the
        // container in the query instead. Returning undefined here would make getFormat() guess VIDEO.
        const queryExt = searchParams.get("format") ?? searchParams.get("ext");
        return queryExt && isExt(queryExt) ? queryExt : undefined;
    } catch {
        return undefined;
    }
}

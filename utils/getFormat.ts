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
import { Format } from "../types";
import { getUrlExtension } from "./getUrlExtension";
import { unwrapChain } from "./unwrapUrl";

/**
 * Which ELEMENT Discord renders this media into: Format.VIDEO -> <video>, Format.IMAGE -> <img>.
 * Getting it wrong renders a black box (image bytes in a <video>) or a broken tile (video in an <img>),
 * so read the container from every layer available before falling back to the video-shaped default:
 *   - media.tenor "gifs" are really mp4s                                   -> VIDEO by host
 *   - wrapper urls (Discord's proxy, ?url= converters) hide the real file  -> peel them
 *   - `localExt` is the extension of the CACHED file, and the only signal a blob: src ever has
 * NEVER derive this from a stored value: it is computed from the url and must be recomputed on
 * render, or a parser fix can't reach media that was saved before it.
 */
export function getFormat(url: string, localExt?: string | null): Format {
    if (url.startsWith("https://media.tenor")) return Format.VIDEO;

    for (const candidate of unwrapChain(url)) {
        const ext = getUrlExtension(candidate)?.toLowerCase();
        if (ext) return VIDEO_EXTS.includes(ext) ? Format.VIDEO : Format.IMAGE;
    }

    const ext = (localExt ?? "").toLowerCase();
    if (ext) return VIDEO_EXTS.includes(ext) ? Format.VIDEO : Format.IMAGE;

    return Format.VIDEO; // no signal anywhere: assume video, as an extension-less tenor url would be
}

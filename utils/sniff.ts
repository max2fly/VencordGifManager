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

/**
 * Identify a media file's extension from its magic bytes. Content is authoritative — a video
 * favorite frequently reaches us as a blob: URL with an empty `blob.type` and no URL extension,
 * and a MIME/extension guess would mislabel it (e.g. an mp4 as "gif"), making the caption editor
 * render a video in an <img> (broken icon) and the decoder take the wrong path. Returns null when
 * the signature is unrecognized so callers can fall back to MIME/URL.
 */
export function sniffExt(bytes: Uint8Array): string | null {
    const b = bytes;
    if (b.length < 12) return null;

    // GIF87a / GIF89a
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "gif";
    // PNG
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return "png";
    // JPEG
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return "jpg";
    // RIFF....WEBP
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
    // EBML → webm/mkv (both decode through the <video> path)
    if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return "webm";
    // ISO-BMFF: bytes 4..8 = "ftyp"; the major brand at 8..12 disambiguates mp4 / mov / avif
    if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
        const brand = String.fromCharCode(b[8], b[9], b[10], b[11]).toLowerCase();
        if (brand.startsWith("avif") || brand.startsWith("avis")) return "avif";
        if (brand.startsWith("qt")) return "mov";
        return "mp4";
    }
    return null;
}

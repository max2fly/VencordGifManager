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

import assert from "node:assert/strict";

import { isAnimated, sniffExt } from "../utils/sniff";

// Build a 16-byte buffer from a list of [index, byte] pairs (rest zero-filled).
function buf(...pairs: [number, number][]): Uint8Array {
    const a = new Uint8Array(16);
    for (const [i, v] of pairs) a[i] = v;
    return a;
}
const ascii = (s: string): [number, number][] => [...s].map((c, i) => [i, c.charCodeAt(0)]);
const at = (off: number, s: string): [number, number][] => [...s].map((c, i) => [off + i, c.charCodeAt(0)]);

// GIF89a
assert.equal(sniffExt(buf(...ascii("GIF89a"))), "gif");
// PNG
assert.equal(sniffExt(buf([0, 0x89], [1, 0x50], [2, 0x4E], [3, 0x47])), "png");
// JPEG
assert.equal(sniffExt(buf([0, 0xFF], [1, 0xD8], [2, 0xFF])), "jpg");
// RIFF....WEBP
assert.equal(sniffExt(buf(...ascii("RIFF"), ...at(8, "WEBP"))), "webp");
// EBML (webm)
assert.equal(sniffExt(buf([0, 0x1A], [1, 0x45], [2, 0xDF], [3, 0xA3])), "webm");
// ISO-BMFF ftyp with brand isom -> mp4  (THIS is the case that was mislabeled "gif")
assert.equal(sniffExt(buf(...at(4, "ftyp"), ...at(8, "isom"))), "mp4");
// ftyp + avif brand -> avif
assert.equal(sniffExt(buf(...at(4, "ftyp"), ...at(8, "avif"))), "avif");
// ftyp + qt brand -> mov
assert.equal(sniffExt(buf(...at(4, "ftyp"), ...at(8, "qt  "))), "mov");
// unknown / too-short -> null (caller falls back to mime/url)
assert.equal(sniffExt(buf([0, 0x00], [1, 0x01])), null);
assert.equal(sniffExt(new Uint8Array(4)), null);

// --- isAnimated: extension-ambiguous animated image containers ---
// 24-byte buffer so the WebP VP8X flags byte at offset 20 is addressable.
function buf24(...pairs: [number, number][]): Uint8Array {
    const a = new Uint8Array(24);
    for (const [i, v] of pairs) a[i] = v;
    return a;
}

// Animated WebP: RIFF/WEBP + VP8X chunk with the animation flag (0x02) set at offset 20.
assert.equal(isAnimated(buf24(...ascii("RIFF"), ...at(8, "WEBP"), ...at(12, "VP8X"), [20, 0x02])), true);
// VP8X present but animation flag clear (e.g. alpha-only 0x10) -> static.
assert.equal(isAnimated(buf24(...ascii("RIFF"), ...at(8, "WEBP"), ...at(12, "VP8X"), [20, 0x10])), false);
// Simple lossy WebP (no VP8X extended header) is always single-frame -> static.
assert.equal(isAnimated(buf24(...ascii("RIFF"), ...at(8, "WEBP"), ...at(12, "VP8 "))), false);
// Animated AVIF sequence brand "avis" -> animated; still "avif" -> static.
assert.equal(isAnimated(buf24(...at(4, "ftyp"), ...at(8, "avis"))), true);
assert.equal(isAnimated(buf24(...at(4, "ftyp"), ...at(8, "avif"))), false);
// Static formats and too-short buffers -> false.
assert.equal(isAnimated(buf24(...ascii("GIF89a"))), false);
assert.equal(isAnimated(buf24([0, 0x89], [1, 0x50], [2, 0x4E], [3, 0x47])), false);
assert.equal(isAnimated(new Uint8Array(12)), false);

console.log("sniff tests passed");

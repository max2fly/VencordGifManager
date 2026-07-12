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

import { classifyMedia } from "../utils/formatClass";

// --- the exact cases the user reported wrong, now asserted correct ---
// real video file on Discord CDN -> video (blue), NOT gif
assert.equal(classifyMedia("https://cdn.discordapp.com/attachments/1444512985304531004/1521631587672920266/2C1286DF-E4EF-4524-96F5-A2F4761C5EBE.mov"), "vid");
// Tenor "gif" (mp4 container) -> gif (no outline), NOT some other format
assert.equal(classifyMedia("https://tenor.com/view/subaru-natsuki-subaru-subaru-re-zero-natsuki-subaru-re-zero-gif-13843176159109827451"), "gif");
assert.equal(classifyMedia("https://media.tenor.com/abcd/subaru.mp4"), "gif");
// klipy gif host -> gif (no outline), NOT image/green
assert.equal(classifyMedia("https://klipy.com/gifs/indian-indian-tiktok"), "gif");
// real .gif file on Discord CDN -> gif (no outline), NOT image/green
assert.equal(classifyMedia("https://cdn.discordapp.com/attachments/1280525407682297906/1286371925026930698/trampoline.gif"), "gif");

// --- general coverage ---
assert.equal(classifyMedia("https://cdn.discordapp.com/attachments/1/2/clip.mp4"), "vid");
assert.equal(classifyMedia("https://cdn.discordapp.com/attachments/1/2/clip.webm"), "vid");
assert.equal(classifyMedia("https://cdn.discordapp.com/attachments/1/2/photo.png"), "img");
assert.equal(classifyMedia("https://cdn.discordapp.com/attachments/1/2/pic.jpg"), "img");
assert.equal(classifyMedia("https://cdn.discordapp.com/attachments/1/2/sticker.webp"), "img");
assert.equal(classifyMedia("https://giphy.com/gifs/foo-123"), "gif");
assert.equal(classifyMedia("https://gif.example.com/x"), "gif");

// extension-less CDN url falls back to localExt
assert.equal(classifyMedia("https://cdn.discordapp.com/attachments/1/2/file", "mp4"), "vid");
assert.equal(classifyMedia("https://cdn.discordapp.com/attachments/1/2/file", "png"), "img");
assert.equal(classifyMedia("https://cdn.discordapp.com/attachments/1/2/file", "gif"), "gif");
// no signal at all -> img (safe default: static render)
assert.equal(classifyMedia("https://example.com/no-ext"), "img");

console.log("formatClass tests passed");

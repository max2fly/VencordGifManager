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
import { getUrlExtension } from "../utils/getUrlExtension";
import { unwrapChain } from "../utils/unwrapUrl";

// --- wrapped / proxied urls: the real media hides behind a converter host or Discord's proxy ---
const VX_GIF = "https://gifconvert.vxtwitter.com/convert.avif?url=https://video.twimg.com/tweet_video/HNC0qCWXEAAizM4.mp4";
const PROXIED_VID = "https://images-ext-1.discordapp.net/external/am05Enkqg5TWw9a-LEqa3-DvwczLmKOVwc2lIZkXaHw/%3Furl%3Dhttps%253A%252F%252Fvideo.twimg.com%252Famplify_video%252F2074738098697814016%252Fvid%252Favc1%252F720x1280%252FyyWzsF8w2ZfdLT-L.mp4%253Ftag%253D28/https/api.fxtwitter.com/2/go";

// vxtwitter's gif converter renders inline animated -> gif (no outline), NOT a static image
assert.equal(classifyMedia(VX_GIF), "gif");
// Discord proxy wrapping fxtwitter -> the twitter mp4 -> video (blue), NOT a static image
assert.equal(classifyMedia(PROXIED_VID), "vid");

// the extension parser must only read the LAST path segment: Discord's proxy embeds the origin
// host in the path, and a whole-path scan grabbed the dot in "api.fxtwitter.com" -> "com/2/go"
assert.equal(getUrlExtension(PROXIED_VID), undefined);
assert.equal(getUrlExtension("https://cdn.discordapp.com/attachments/1/2/my.file.name.mp4"), "mp4");
assert.equal(getUrlExtension("https://example.com/v1.2/download"), undefined);

// unwrapping peels the proxy, then the ?url= param, down to the real file
assert.deepEqual(unwrapChain(PROXIED_VID), [
    PROXIED_VID,
    "https://api.fxtwitter.com/2/go?url=https%3A%2F%2Fvideo.twimg.com%2Famplify_video%2F2074738098697814016%2Fvid%2Favc1%2F720x1280%2FyyWzsF8w2ZfdLT-L.mp4%3Ftag%3D28",
    "https://video.twimg.com/amplify_video/2074738098697814016/vid/avc1/720x1280/yyWzsF8w2ZfdLT-L.mp4?tag=28"
]);
assert.deepEqual(unwrapChain("https://cdn.discordapp.com/attachments/1/2/clip.mp4"), ["https://cdn.discordapp.com/attachments/1/2/clip.mp4"]);

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

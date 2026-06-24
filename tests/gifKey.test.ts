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

import { classifyHost, getGifKey, hashKey } from "../utils/gifKey";

// identity strips Discord signature params (ex/is/hm) only
assert.equal(
    getGifKey("https://cdn.discordapp.com/attachments/1/2/a.gif?ex=1&is=2&hm=3&"),
    "https://cdn.discordapp.com/attachments/1/2/a.gif"
);

// Discord CDN rendering hints (width/height) are NOT identity — same gif at any size -> one key
assert.equal(
    getGifKey("https://media.discordapp.net/attachments/1/2/lost7.gif?width=1332&height=1469"),
    "https://media.discordapp.net/attachments/1/2/lost7.gif"
);
assert.equal(
    getGifKey("https://media.discordapp.net/attachments/1/2/lost7.gif?width=400&height=441"),
    getGifKey("https://media.discordapp.net/attachments/1/2/lost7.gif?width=1332&height=1469")
);

// Non-Discord hosts: PRESERVE query (e.g. proxy ?url=...) so distinct gifs don't collide
const proxyA = "https://gifconvert.vxtwitter.com/convert.avif?url=https://video.twimg.com/tweet_video/HKnzOxAW0AAXSsW.mp4";
const proxyB = "https://gifconvert.vxtwitter.com/convert.avif?url=https://video.twimg.com/tweet_video/HKgsBaJXAAAEOuM.mp4";
assert.notEqual(getGifKey(proxyA), getGifKey(proxyB));
assert.ok(getGifKey(proxyA).includes("HKnzOxAW0AAXSsW"));

// host classification
assert.equal(classifyHost("https://media.tenor.com/abc/x.gif"), "tenor");
assert.equal(classifyHost("https://tenor.com/view/x-123"), "tenor");
assert.equal(classifyHost("https://cdn.discordapp.com/attachments/1/2/a.gif"), "cdn");
assert.equal(classifyHost("https://i.imgur.com/x.gif"), "other");

// hash: deterministic, stable, filename-safe
const h1 = hashKey("https://cdn.discordapp.com/attachments/1/2/a.gif");
assert.equal(h1, hashKey("https://cdn.discordapp.com/attachments/1/2/a.gif"));
assert.match(h1, /^[0-9a-f]+$/);
assert.notEqual(h1, hashKey("https://cdn.discordapp.com/attachments/1/2/b.gif"));

console.log("gifKey.test.ts passed");

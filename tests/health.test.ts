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

import { classifyFetchResult } from "../utils/health";

// Success + network-error verdicts are host-independent.
for (const host of ["cdn", "tenor", "other"] as const) {
    assert.equal(classifyFetchResult({ status: 200 }, host), "ok");
    // 3xx never surfaces (redirects auto-followed), but if it did it's not an error.
    assert.equal(classifyFetchResult({ status: 302 }, host), "ok");
    // status <= 0 = no response reached us (network error/timeout) → our own connectivity, send the link.
    assert.equal(classifyFetchResult({ status: 0 }, host), "transient");
    assert.equal(classifyFetchResult({ status: -1 }, host), "transient");
}

// Discord CDN: a raw probe re-signs on send / restricts direct access, so ONLY 404 NoSuchKey
// (which needs a validly-signed url) is a real "gone"; every other error → transient (send link).
assert.equal(classifyFetchResult({ status: 404, bodyText: "<Error><Code>NoSuchKey</Code></Error>" }, "cdn"), "unavailable");
assert.equal(classifyFetchResult({ status: 404, bodyText: "" }, "cdn"), "transient");
assert.equal(classifyFetchResult({ status: 403 }, "cdn"), "transient");
assert.equal(classifyFetchResult({ status: 500 }, "cdn"), "transient");

// Non-Discord hosts: a direct fetch is exactly what recipients get, so any HTTP error = dead.
// fxtwitter's dead tweet-gif blender returns 500 — must be caught.
assert.equal(classifyFetchResult({ status: 500 }, "other"), "unavailable");
assert.equal(classifyFetchResult({ status: 404, bodyText: "" }, "other"), "unavailable");
assert.equal(classifyFetchResult({ status: 403 }, "tenor"), "unavailable");
assert.equal(classifyFetchResult({ status: 404 }, "tenor"), "unavailable");

console.log("health.test.ts passed");

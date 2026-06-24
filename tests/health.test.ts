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

assert.equal(classifyFetchResult({ status: 200 }), "ok");
assert.equal(
    classifyFetchResult({ status: 404, bodyText: "<Error><Code>NoSuchKey</Code></Error>" }),
    "gone"
);
// 404 without NoSuchKey (e.g. bare-url/permission) is NOT a confirmed delete
assert.equal(classifyFetchResult({ status: 404, bodyText: "" }), "transient");
assert.equal(classifyFetchResult({ status: 403 }), "expired");
assert.equal(classifyFetchResult({ status: 500 }), "transient");
assert.equal(classifyFetchResult({ status: 0 }), "transient");
assert.equal(classifyFetchResult({ status: -1 }), "transient");

console.log("health.test.ts passed");

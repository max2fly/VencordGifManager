/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";

import { TRASH_CATEGORY_NAME } from "../constants";
import { Collection } from "../types";
import {
    displayToStored, ensureOrder, isReservedName, regularCollectionKeys,
    renameInList, reorderCollectionsList, reorderGifInList, sortedRegularCollections
} from "../utils/collectionOps";

const gif = (id: string) => ({ id, url: `https://cdn.discordapp.com/x/${id}.gif`, src: `https://cdn.discordapp.com/x/${id}.gif`, width: 1, height: 1 });
const col = (name: string, order: number | undefined, ids: string[] = []): Collection =>
    ({ name, src: "", format: 2, type: "Category", order, gifs: ids.map(gif) } as Collection);

// --- isReservedName ---
assert.equal(isReservedName(TRASH_CATEGORY_NAME), true);
assert.equal(isReservedName("🗑 Trash"), true);
assert.equal(isReservedName("My Reactions"), false);

// --- displayToStored (grid renders reversed) ---
assert.equal(displayToStored(4, 0), 3);
assert.equal(displayToStored(4, 3), 0);

// --- reorderGifInList: id-based, reversal-correct ---
// stored [A,B,C,D], grid shows [D,C,B,A]. Drag display0 (D) onto display2 (B): fromId D, toId B.
let r = reorderGifInList([col("c", 0, ["A", "B", "C", "D"])], "c", "D", "B")[0].gifs.map(g => g.id);
assert.deepEqual(r, ["A", "D", "B", "C"]);
// Drag display3 (A) onto display1 (C): fromId A, toId C.
r = reorderGifInList([col("c", 0, ["A", "B", "C", "D"])], "c", "A", "C")[0].gifs.map(g => g.id);
assert.deepEqual(r, ["B", "C", "A", "D"]);
// no-op cases
assert.deepEqual(reorderGifInList([col("c", 0, ["A", "B"])], "c", "A", "A")[0].gifs.map(g => g.id), ["A", "B"]);
assert.deepEqual(reorderGifInList([col("c", 0, ["A", "B"])], "c", "Z", "A")[0].gifs.map(g => g.id), ["A", "B"]);
// cover recomputes to the new last gif's src
const reordered = reorderGifInList([col("c", 0, ["A", "B", "C"])], "c", "C", "A")[0];
assert.equal(reordered.gifs[reordered.gifs.length - 1].id, "B");
assert.equal(reordered.src, reordered.gifs[reordered.gifs.length - 1].src);

// --- reorderCollectionsList: name-based, renumbers order, reserved untouched ---
const list = [col(TRASH_CATEGORY_NAME, -1), col("a", 0), col("b", 1), col("c", 2)];
const rc = reorderCollectionsList(list, "c", "a"); // move c into a's slot
assert.deepEqual(sortedRegularCollections(rc).map(c2 => c2.name), ["c", "a", "b"]);
assert.deepEqual(sortedRegularCollections(rc).map(c2 => c2.order), [0, 1, 2]);
assert.ok(rc.some(c2 => c2.name === TRASH_CATEGORY_NAME));      // reserved preserved
assert.equal(reorderCollectionsList(list, TRASH_CATEGORY_NAME, "a"), list); // can't move reserved

// --- renameInList ---
assert.equal(renameInList(list, "a", "").ok, false);                     // empty
assert.equal(renameInList(list, "a", "b").ok, false);                    // dupe
assert.equal(renameInList(list, TRASH_CATEGORY_NAME, "z").ok, false);   // reserved
const rn = renameInList(list, "a", "alpha");
assert.equal(rn.ok, true);
assert.ok(rn.collections.some(c2 => c2.name === "alpha"));
assert.ok(!rn.collections.some(c2 => c2.name === "a"));

// --- regularCollectionKeys: excludes reserved ---
const mediaList = [col(TRASH_CATEGORY_NAME, -1, ["M1"]), col("a", 0, ["A1", "A2"])];
const keys = regularCollectionKeys(mediaList);
assert.equal(keys.has("https://cdn.discordapp.com/x/A1.gif"), true);
assert.equal(keys.has("https://cdn.discordapp.com/x/M1.gif"), false); // reserved member NOT counted

// --- ensureOrder: assigns reverse-index (preserves old `.reverse()` display), idempotent ---
const noOrder = [col("a", undefined), col("b", undefined), col("c", undefined)];
const eo = ensureOrder(noOrder);
assert.equal(eo.changed, true);
// old render showed last-array-first, so last ("c") must get order 0 (shown first)
assert.deepEqual(sortedRegularCollections(eo.collections).map(c2 => c2.name), ["c", "b", "a"]);
assert.equal(ensureOrder(eo.collections).changed, false); // idempotent

// --- ensureOrder: partial case — preserve existing orders, append missing after max ---
const partial = [col("a", 0), col("b", 1), col("c", undefined)];
const ep = ensureOrder(partial);
assert.equal(ep.changed, true);
// a and b must keep their original orders
assert.equal(ep.collections.find(c2 => c2.name === "a")!.order, 0);
assert.equal(ep.collections.find(c2 => c2.name === "b")!.order, 1);
// c gets max+1 = 2 (appended after the existing max of 1)
assert.equal(ep.collections.find(c2 => c2.name === "c")!.order, 2);
// idempotent after the partial backfill
assert.equal(ensureOrder(ep.collections).changed, false);

console.log("collectionOps.test.ts passed");

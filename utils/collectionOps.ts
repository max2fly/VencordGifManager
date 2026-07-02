/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { TRASH_CATEGORY_NAME } from "../constants";
import { Collection } from "../types";
import { getFormat } from "./getFormat";
import { getGifKey } from "./gifKey";

// Reserved pseudo-collections: not user-renamable/-deletable, excluded from the regular tiles list
// and from "is this gif in a collection" membership.
export const isReservedName = (name: string): boolean =>
    name === TRASH_CATEGORY_NAME;

// A collection's gif grid renders `gifs` reversed; map a display (grid) index to a stored index.
// Kept for callers that only have an index; the reorder op itself is id-based and needs no mapping.
export const displayToStored = (len: number, displayIndex: number): number => len - 1 - displayIndex;

// Recompute a collection's cover (src/format) from its last gif. No-op when empty.
function recomputeCover(col: Collection): void {
    const last = col.gifs[col.gifs.length - 1];
    if (last) { col.src = last.src; col.format = getFormat(last.src); }
}

// Move the gif identified by `fromId` to the ORIGINAL stored slot of `toId`, within `collectionName`.
// id-based (not index-based) so it is correct under reversal AND filtering (media-favorites hide).
// Inputs are not mutated. Unknown ids / same id -> unchanged clone.
export function reorderGifInList(
    collections: Collection[], collectionName: string, fromId: string, toId: string
): Collection[] {
    return collections.map(c => {
        if (c.name !== collectionName) return c;
        const gifs = c.gifs.slice();
        const fromIdx = gifs.findIndex(g => g.id === fromId);
        const toIdx = gifs.findIndex(g => g.id === toId);
        if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return { ...c, gifs };
        const [moved] = gifs.splice(fromIdx, 1);
        gifs.splice(toIdx, 0, moved);   // toIdx = target's original stored index (validated in tests)
        const next = { ...c, gifs };
        recomputeCover(next);
        return next;
    });
}

// Move regular collection `moveName` into `targetName`'s slot, then renumber all regular `order`s
// to a dense 0..n-1 sequence. Reserved collections are left untouched and kept in place.
export function reorderCollectionsList(
    collections: Collection[], moveName: string, targetName: string
): Collection[] {
    if (isReservedName(moveName) || isReservedName(targetName)) return collections;
    const reserved = collections.filter(c => isReservedName(c.name));
    const regular = collections.filter(c => !isReservedName(c.name))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const from = regular.findIndex(c => c.name === moveName);
    const to = regular.findIndex(c => c.name === targetName);
    if (from === -1 || to === -1) return collections;
    const [moved] = regular.splice(from, 1);
    regular.splice(to, 0, moved);
    const renumbered = regular.map((c, i) => ({ ...c, order: i }));
    return [...reserved, ...renumbered];
}

// Rename a regular collection. Rejects empty / duplicate / reserved / missing.
export function renameInList(
    collections: Collection[], oldName: string, newName: string
): { ok: boolean; collections: Collection[]; error?: string } {
    newName = newName.trim();
    if (!newName) return { ok: false, collections, error: "Name cannot be empty" };
    if (isReservedName(oldName)) return { ok: false, collections, error: "That collection can't be renamed" };
    if (oldName === newName) return { ok: true, collections };
    if (collections.some(c => c.name === newName)) return { ok: false, collections, error: "That collection already exists" };
    if (!collections.some(c => c.name === oldName)) return { ok: false, collections, error: "Collection not found" };
    return { ok: true, collections: collections.map(c => c.name === oldName ? { ...c, name: newName } : c) };
}

// Keys of every gif in any REGULAR (non-reserved) collection. Single source of truth for the
// native-favorites hide AND the media-favorites hide.
export function regularCollectionKeys(collections: Collection[]): Set<string> {
    const set = new Set<string>();
    for (const c of collections) {
        if (isReservedName(c.name)) continue;
        for (const g of c.gifs) set.add(getGifKey(g.url));
    }
    return set;
}

// Regular collections sorted by `order` ascending (reserved excluded). Drives the tiles row.
export function sortedRegularCollections(collections: Collection[]): Collection[] {
    return collections.filter(c => !isReservedName(c.name)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

// Migration / backfill: ensure every regular collection has a numeric `order`.
//
// Three cases:
//   • None missing  → return unchanged (idempotent fast-path).
//   • All missing   → legacy migration: assign reverse-index (n-1-i) so the old
//                     `.slice().reverse()` display order is preserved.
//   • Some missing  → preserve every existing numeric order; assign each missing one
//                     a new order strictly greater than the current max (append in
//                     encounter order). Does NOT renumber collections that already
//                     have an order.
export function ensureOrder(collections: Collection[]): { collections: Collection[]; changed: boolean } {
    const regular = collections.filter(c => !isReservedName(c.name));
    const missing = regular.filter(c => typeof c.order !== "number");

    if (missing.length === 0) return { collections, changed: false };

    if (missing.length === regular.length) {
        // All missing: legacy migration — assign reverse-index to preserve old `.slice().reverse()` display
        const n = regular.length;
        const orderByName = new Map<string, number>();
        regular.forEach((c, i) => orderByName.set(c.name, n - 1 - i));
        const next = collections.map(c => isReservedName(c.name) ? c : { ...c, order: orderByName.get(c.name)! });
        return { collections: next, changed: true };
    }

    // Partial: preserve existing orders; append missing ones after the current max.
    const maxOrder = Math.max(...regular.filter(c => typeof c.order === "number").map(c => c.order as number));
    let nextSlot = maxOrder + 1;
    const orderForMissing = new Map<string, number>();
    for (const c of missing) orderForMissing.set(c.name, nextSlot++);

    const next = collections.map(c => {
        if (isReservedName(c.name)) return c;
        if (typeof c.order === "number") return c;        // already has order — preserve it
        return { ...c, order: orderForMissing.get(c.name)! };
    });
    return { collections: next, changed: true };
}

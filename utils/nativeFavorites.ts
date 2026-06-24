/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2024 Vendicated and contributors
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

import { Gif } from "../types";
import { getGifKey } from "./gifKey";

// Discord favorites live in the Frecency user-settings proto; there's no exported
// add/remove. We capture the proto updater Discord itself uses
// (`<x>.updateAsync("favoriteGifs", cb)`) via a patch on its call site, then drive the
// same machinery to add/remove favorites by an arbitrary url — the only way to favorite
// a freshly-reuploaded attachment (which has no picker surface for the ⭐ button).
type FavUpdater = { updateAsync(field: string, cb: (proto: any) => void): void; };

let favUpdater: FavUpdater | null = null;

/** Called from the capture patch the first time the user favorites/unfavorites anything. */
export function captureFavUpdater(updater: FavUpdater) {
    if (!favUpdater && updater?.updateAsync) favUpdater = updater;
}

export function hasFavUpdater() {
    return favUpdater != null;
}

// Remove every entry whose identity (key value, or stored url, stripped) matches url.
// Matched by value so we don't depend on Discord's internal key normalizer.
function removeFromProto(proto: any, url: string) {
    const target = getGifKey(url);
    for (const key of Object.keys(proto.gifs ?? {})) {
        const e = proto.gifs[key];
        if (key === url || e?.url === url || getGifKey(e?.url ?? key) === target) delete proto.gifs[key];
    }
}

// Add a favorite entry. Templated off an existing favorite so we match Discord's exact proto
// shape + format-enum value at runtime; keyed + urled by the SIGNATURE-STRIPPED url (Discord's
// isFavorite looks up the stripped url, so the raw signed url would leave it unmarked → dupes).
function addToProto(proto: any, gif: Gif & { format?: number; }) {
    proto.gifs ??= {};
    const entries = Object.values<any>(proto.gifs);
    const order = (entries.length ? Math.max(...entries.map(g => g.order ?? 0)) : 0) + 1;
    const template = entries.find(g => /\.(gif|webp|avif)(\?|$)/i.test(g.src ?? "")) ?? entries[0];
    const entry = template ? { ...template } : {};
    const key = getGifKey(gif.url);
    entry.url = key;
    entry.src = key;
    if (gif.width != null) entry.width = gif.width;
    if (gif.height != null) entry.height = gif.height;
    if (gif.format != null) entry.format = gif.format;
    entry.order = order;
    proto.gifs[key] = entry;
}

export function nativeUnfavorite(url: string): boolean {
    if (!favUpdater) return false;
    favUpdater.updateAsync("favoriteGifs", proto => removeFromProto(proto, url));
    return true;
}

export function nativeFavorite(gif: Gif & { format?: number; }): boolean {
    if (!favUpdater) return false;
    favUpdater.updateAsync("favoriteGifs", proto => addToProto(proto, gif));
    return true;
}

/**
 * Atomically swap a favorite: remove the old (dead) url and add the new one in ONE proto
 * update — so they can't race into a state where both entries survive (the "kept both" bug).
 */
export function nativeRebaseFavorite(oldUrl: string, gif: Gif & { format?: number; }): boolean {
    if (!favUpdater) return false;
    favUpdater.updateAsync("favoriteGifs", proto => {
        removeFromProto(proto, oldUrl);
        addToProto(proto, gif);
    });
    return true;
}

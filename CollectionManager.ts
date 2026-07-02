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

import { DataStore } from "@api/index";
import { Toasts } from "@webpack/common";

import { GIF_COLLECTION_PREFIX, MEDIA_FAVORITES_NAME } from "./constants";
import * as GifLibrary from "./GifLibrary";
import { settings } from "./index";
import { Collection, Gif } from "./types";
import { ensureOrder, isReservedName, renameInList, reorderCollectionsList, reorderGifInList } from "./utils/collectionOps";
import { getFormat } from "./utils/getFormat";
import { getGifKey } from "./utils/gifKey";

export const DATA_COLLECTION_NAME = "gif-collections-collections";

// A gif rendered in the picker has its `src` swapped to a session-only blob: object URL.
// Never persist that — restore the original media src from the library (or fall back to the
// stable `url`) so stored collections keep a real, reusable url.
const normalizeGif = (gif: Gif): Gif => {
    if (!gif?.src?.startsWith("blob:")) return gif;
    const original = GifLibrary.getRecord(getGifKey(gif.url))?.src ?? gif.url;
    return { ...gif, src: original };
};

// this is here bec async + react class component dont play nice and stutters happen. IF theres a better way of doing it pls let me know
export let cache_collections: Collection[] = [];

export const getCollections = async (): Promise<Collection[]> => (await DataStore.get<Collection[]>(DATA_COLLECTION_NAME)) ?? [];

export const getCollection = async (name: string): Promise<Collection | undefined> => {
    const collections = await getCollections();
    return collections.find(c => c.name === name);
};

export const getCachedCollection = (name: string): Collection | undefined => cache_collections.find(c => c.name === name);

export const createCollection = async (name: string, gifs: Gif[]): Promise<void> => {
    gifs = gifs.map(normalizeGif);

    const collections = await getCollections();
    const duplicateCollection = collections.find(c => c.name === name);
    if (duplicateCollection)
        return Toasts.show({
            message: "That collection already exists",
            type: Toasts.Type.FAILURE,
            id: Toasts.genId(),
            options: {
                duration: 3000,
                position: Toasts.Position.BOTTOM
            }
        });

    // gifs shouldnt be empty because to create a collection you need to right click an image / gif and then create it yk. but cant hurt to have a null-conditional check RIGHT?
    const latestGifSrc = gifs[gifs.length - 1]?.src ?? settings.store.defaultEmptyCollectionImage;
    // Assign an order strictly below the current minimum so this collection appears FIRST in the
    // sorted tile row (sortedRegularCollections sorts ascending). This also prevents ensureOrder
    // from treating the new collection as "missing an order" and triggering a full reindex.
    const orders = collections.filter(c => !isReservedName(c.name)).map(c => c.order ?? 0);
    const order = (orders.length ? Math.min(...orders) : 0) - 1;
    const collection = {
        name,
        src: latestGifSrc,
        format: getFormat(latestGifSrc),
        type: "Category",
        order,
        gifs
    };

    await DataStore.set(DATA_COLLECTION_NAME, [...collections, collection]);
    return await refreshCacheCollection();
};

export const addToCollection = async (name: string, gif: Gif): Promise<void> => {
    gif = normalizeGif(gif);
    const collections = await getCollections();
    const collectionIndex = collections.findIndex(c => c.name === name);
    if (collectionIndex === -1) return console.warn("collection not found");

    collections[collectionIndex].gifs.push(gif);
    collections[collectionIndex].src = gif.src;
    collections[collectionIndex].format = getFormat(gif.src);

    await DataStore.set(DATA_COLLECTION_NAME, collections);
    return await refreshCacheCollection();

};

export const removeFromCollection = async (id: string): Promise<void> => {
    const collections = await getCollections();
    const collectionIndex = collections.findIndex(c => c.gifs.some(g => g.id === id));
    if (collectionIndex === -1) return console.warn("collection not found");

    // Remove The Gif
    collections[collectionIndex].gifs = collections[collectionIndex].gifs.filter(g => g.id !== id);

    const collection = collections[collectionIndex];
    const latestGifSrc = collection.gifs.length ? collection.gifs[collection.gifs.length - 1].src : settings.store.defaultEmptyCollectionImage;
    collections[collectionIndex].src = latestGifSrc;
    collections[collectionIndex].format = getFormat(latestGifSrc);

    await DataStore.set(DATA_COLLECTION_NAME, collections);
    return await refreshCacheCollection();
};

// Post-recovery rebase: a gif's dead url has been replaced by a fresh reuploaded one.
// Update it in place in whatever collection holds it, preserving the gif's position.
export const replaceGifUrl = async (oldUrl: string, newUrl: string): Promise<void> => {
    const collections = await getCollections();
    let changed = false;
    for (const c of collections) {
        for (const g of c.gifs) {
            if (getGifKey(g.url) === getGifKey(oldUrl)) {
                g.url = newUrl;
                g.src = newUrl;
                g.key = getGifKey(newUrl);
                changed = true;
            }
        }
    }
    if (changed) {
        await DataStore.set(DATA_COLLECTION_NAME, collections);
        await refreshCacheCollection();
    }
};

export const deleteCollection = async (name: string): Promise<void> => {

    const collections = await getCollections();
    const col = collections.filter(c => c.name !== name);
    await DataStore.set(DATA_COLLECTION_NAME, col);
    await refreshCacheCollection();
};


export const reorderGif = async (collectionName: string, fromId: string, toId: string): Promise<void> => {
    const collections = await getCollections();
    await DataStore.set(DATA_COLLECTION_NAME, reorderGifInList(collections, collectionName, fromId, toId));
    return await refreshCacheCollection();
};

// Reorder the collection tiles: move `moveName` into `targetName`'s slot (by name, from the drag).
export const reorderCollection = async (moveName: string, targetName: string): Promise<void> => {
    const collections = await getCollections();
    await DataStore.set(DATA_COLLECTION_NAME, reorderCollectionsList(collections, moveName, targetName));
    return await refreshCacheCollection();
};

export const renameCollection = async (oldName: string, newName: string): Promise<boolean> => {
    const collections = await getCollections();
    const res = renameInList(collections, oldName, newName);
    if (!res.ok) {
        Toasts.show({ message: res.error ?? "Rename failed", type: Toasts.Type.FAILURE, id: Toasts.genId(), options: { duration: 3000, position: Toasts.Position.BOTTOM } });
        return false;
    }
    await DataStore.set(DATA_COLLECTION_NAME, res.collections);
    await refreshCacheCollection();
    return true;
};

export const refreshCacheCollection = async (): Promise<void> => {
    let collections = await getCollections();
    // Migration: older versions stored collection names with a "gc:" prefix. We no
    // longer use a prefix (collections are matched by exact name), so strip it once.
    let changed = false;
    for (const c of collections) {
        if (c.name.startsWith(GIF_COLLECTION_PREFIX)) {
            c.name = c.name.slice(GIF_COLLECTION_PREFIX.length);
            changed = true;
        }
    }
    // One-time cleanup: the old custom "Favorite Media" pseudo-collection is retired (media is now
    // favorited natively). Drop it if present; its cached files simply become trashcan orphans.
    if (collections.some(c => c.name === MEDIA_FAVORITES_NAME)) {
        collections = collections.filter(c => c.name !== MEDIA_FAVORITES_NAME);
        changed = true;
    }
    const eo = ensureOrder(collections);
    if (eo.changed) { collections = eo.collections; changed = true; }
    if (changed) await DataStore.set(DATA_COLLECTION_NAME, collections);
    cache_collections = collections;
};


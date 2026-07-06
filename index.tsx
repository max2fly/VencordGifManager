/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
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

// Plugin idea by brainfreeze (668137937333911553) 😎

import { addContextMenuPatch, findGroupChildrenByChildId, NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { Alerts, Button, ContextMenuApi, FluxDispatcher, Forms, Menu, React, TextInput, Toasts, useCallback, useState } from "@webpack/common";

import * as CollectionManager from "./CollectionManager";
import { GIF_ITEM_PREFIX, TRASH_CATEGORY_NAME } from "./constants";
import { isReservedName, regularCollectionKeys, sortedRegularCollections } from "./utils/collectionOps";
import * as GifLibrary from "./GifLibrary";
import { getObjectUrl, getObjectUrlSync, revokeAll } from "./gifCache";
import { Collection, Gif, GifRecord, Props } from "./types";
import { cacheGif, healthCheck } from "./utils/favorites";
import { getFormat } from "./utils/getFormat";
import { getGif } from "./utils/getGif";
import { classifyHost, getGifKey } from "./utils/gifKey";
import { captureFavUpdater as captureFavUpdaterImpl, nativeFavorite } from "./utils/nativeFavorites";
import { onMessageCreate, recoverGif } from "./utils/reupload";
import { deleteOrphan, getOrphans, isOrphan, purgeTrash, setFavoriteKeys, sweepLeakedFiles } from "./utils/trash";
import { downloadCollections, uploadGifCollections } from "./utils/settingsUtils";
import { uuidv4 } from "./utils/uuidv4";
import { ensureDragStyle, removeDragStyle, startDragReorder } from "./utils/dragReorder";
import { disableMediaStar, enableMediaStar, loadPersistedFavorites, syncFavoritedUrls } from "./utils/mediaStar";
import { getItemFromNode } from "./utils/reactInternals";
import { classifyMedia } from "./utils/formatClass";
import { openCaptionEditor } from "./components/CaptionEditorModal";
import { disableCaptionNavButton, enableCaptionNavButton } from "./utils/captionNavButton";
import { convertAndStage, loadSource } from "./utils/mediaConvert";

export const settings = definePluginSettings({
    gifPasteHint: {
        type: OptionType.COMPONENT,
        description: "GifPaste tip",
        component: () => (
            <Forms.FormText style={{ marginBottom: "8px" }}>
                Tip: enable the built-in <b>GifPaste</b> plugin if you want clicking a gif to insert
                its link into the chat box instead of sending immediately. GifManager works alongside
                it and only takes over the click for gifs whose source was deleted (to recover them
                from your local backup).
            </Forms.FormText>
        )
    },
    defaultEmptyCollectionImage: {
        description: "The image / gif that will be shown when a collection has no images / gifs",
        type: OptionType.STRING,
        default: "https://i.imgur.com/TFatP8r.png"
    },
    showFormatOutlines: {
        type: OptionType.BOOLEAN,
        description: "Outline picker tiles by type: blue = video, green = image, none = gif",
        default: true
    },
    importGifs: {
        type: OptionType.COMPONENT,
        description: "Import Collections",
        component: () =>
            <Button onClick={async () =>
                // if they have collections show the warning
                (await CollectionManager.getCollections()).length ? Alerts.show({
                    title: "Are you sure?",
                    body: "Importing collections will overwrite your current collections.",
                    confirmText: "Import",
                    // wow this works?
                    confirmColor: Button.Colors.RED,
                    cancelText: "Nevermind",
                    onConfirm: async () => uploadGifCollections()

                }) : uploadGifCollections()}>
                Import Collections
            </Button>,
    },
    exportGifs: {
        type: OptionType.COMPONENT,
        description: "Export Collections",
        component: () =>
            <Button onClick={downloadCollections}>
                Export Collections
            </Button>
    },
    purgeTrash: {
        type: OptionType.COMPONENT,
        description: "Empty the trashcan (permanently delete all cached gifs that aren't favorited or in a collection)",
        component: () =>
            <Button color={Button.Colors.RED} onClick={() => Alerts.show({
                title: "Empty trashcan?",
                body: "This permanently deletes the local backups of all cached gifs that are no longer favorited or in a collection. This cannot be undone.",
                confirmText: "Delete",
                confirmColor: Button.Colors.RED,
                cancelText: "Nevermind",
                onConfirm: async () => {
                    const n = await purgeTrash();
                    const leaked = await sweepLeakedFiles();
                    Toasts.show({ message: `Removed ${n} trashed gif(s) + ${leaked} leaked file(s)`, type: Toasts.Type.SUCCESS, id: Toasts.genId() });
                }
            })}>
                Empty Trashcan
            </Button>
    }
});


const addCollectionContextMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    if (!props) return;

    const { message, itemSrc, itemHref, target } = props;

    const gif = getGif(message, itemSrc ?? itemHref, target);

    if (!gif) return;

    const group = findGroupChildrenByChildId("open-native-link", children) ?? findGroupChildrenByChildId("copy-link", children);
    if (group && !group.some(child => child?.props?.id === "add-to-collection")) {
        group.push(
            // if i do it the normal way i get a invalid context menu thingy error -> Menu API only allows Items and groups of Items as children.
            MenuThingy({ gif })
        );
        // (Favoriting images/videos now lives on the hover ⭐ on the media itself — see mediaStar.ts.)

        // getGif already resolves image/video/gif embeds + attachments (audio excluded), so gif.url
        // / gif.src is the message's media regardless of type. Caption works for any media; Convert
        // shows for anything that isn't already a gif (video → animated gif, image → 1-frame gif).
        group.push(
            <Menu.MenuItem
                id="gifmgr-add-caption"
                key="gifmgr-add-caption"
                label="Add Caption"
                action={async () => {
                    const src = await loadSource({ url: gif.url, src: gif.src });
                    if (src) openCaptionEditor(src);
                    else Toasts.show({ message: "Couldn't load this media", type: Toasts.Type.FAILURE, id: Toasts.genId(), options: { duration: 3000, position: Toasts.Position.BOTTOM } });
                }}
            />
        );
        if (classifyMedia(gif.url) !== "gif") {
            group.push(
                <Menu.MenuItem
                    id="gifmgr-convert-gif"
                    key="gifmgr-convert-gif"
                    label="Convert & Paste as GIF"
                    action={async () => {
                        const src = await loadSource({ url: gif.url, src: gif.src });
                        if (src) await convertAndStage(src.blob, src.ext);
                        else Toasts.show({ message: "Couldn't load this media", type: Toasts.Type.FAILURE, id: Toasts.genId(), options: { duration: 3000, position: Toasts.Position.BOTTOM } });
                    }}
                />
            );
        }
    }
};


function collectionKeySet(): Set<string> {
    // Single source of truth (excludes reserved: media favorites must not hide themselves).
    return regularCollectionKeys(CollectionManager.cache_collections);
}

// Coalesce the many "a gif just became locally available" callbacks (progressive
// hydration of a large favorites list) into a single re-render, so we don't
// forceUpdate hundreds of times.
let updateTimer: ReturnType<typeof setTimeout> | null = null;
let pendingInstance: { forceUpdate?: () => void; } | null = null;
function scheduleUpdate(instance: { forceUpdate?: () => void; }) {
    pendingInstance = instance;
    if (updateTimer) return;
    updateTimer = setTimeout(() => {
        updateTimer = null;
        const i = pendingInstance;
        pendingInstance = null;
        i?.forceUpdate?.();
    }, 120);
}

const OUTLINE_STYLE_ID = "gifmgr-fmt-style";
function ensureOutlineStyle() {
    if (document.getElementById(OUTLINE_STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = OUTLINE_STYLE_ID;
    // The outline is drawn as an ::after OVERLAY (not `outline`/`border`): the tile's media child
    // forms its own stacking context and paints over an outline on the root — leaving only the
    // rounded corners visible. A positioned ::after with a high z-index sits ABOVE the media, so the
    // full border shows. inset:0 + border-radius:inherit matches the tile; pointer-events:none keeps
    // clicks working. Attribute selectors (data-gifmgr-fmt injected at the reliable handleClick site).
    s.textContent =
        '[data-gifmgr-fmt="vid"],[data-gifmgr-fmt="img"]{position:relative}' +
        '[data-gifmgr-fmt="vid"]::after,[data-gifmgr-fmt="img"]::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:3;box-sizing:border-box}' +
        '[data-gifmgr-fmt="vid"]::after{border:3px solid #3b82f6}' +
        '[data-gifmgr-fmt="img"]::after{border:3px solid #22c55e}';
    document.head.appendChild(s);
}
function removeOutlineStyle() { document.getElementById(OUTLINE_STYLE_ID)?.remove(); }

export default definePlugin({
    name: "GifManager",
    description: "Locally backs up favorited gifs and organizes them into collections",
    authors: [Devs.Aria, {id: 236950175480807424n, name: "max2fly" }],
    patches: [
        {
            find: "renderCategoryExtras",
            replacement: [
                // This patch adds the collections to the gif part yk
                {
                    match: /(render\(\){)(.{1,50}getItemGrid)/,
                    replace: "$1;$self.insertCollections(this);$2"
                },
            ]
        },
        {
            find: "renderEmptyFavorite",
            replacement: [
                {
                    // Inject our handlers AND the format-outline data attribute at the same reliable
                    // site (the tile root's props object). data-* forwards to the host DOM node and
                    // never collides with Discord's own props — unlike guessing the minified className.
                    match: /render\(\){.{1,500}onClick:this\.handleClick,/,
                    replace: "$&onContextMenu: (e) => $self.collectionContextMenu(e, this),onMouseDown: (e) => $self.onItemMouseDown(e, this),\"data-gifmgr-fmt\": $self.formatClass(this.props.item),"
                }
            ]
        },
        {
            find: "renderHeaderContent()",
            replacement: [
                // Replaces this.props.resultItems with the collection.gifs
                {
                    match: /(renderContent\(\){)(.{1,50}resultItems)/,
                    replace: "$1$self.renderContent(this);$2"
                },
                // NOTE: the "Caption maker" button used to be spliced here (search-bar row).
                // It now lives in the ExpressionPicker tab row via utils/captionNavButton.ts
                // (DOM injection off the stable tablist), so no header patch is needed.
            ]
        },
        /*
        problem:
            when you click your collection in the gifs picker discord enters the collection name into the search bar
            which causes discord to fetch the gifs from their api. This causes a tiny flash when the gifs have fetched successfully
        solution:
            if query starts with gc: and collection is not null then return early and prevent the fetch
        */
        {
            find: "type:\"GIF_PICKER_QUERY\"",
            replacement: {
                match: /(function \i\(.{1,10}\){)(.{1,100}.GIFS_SEARCH,query:)/,
                replace:
                    "$1if($self.shouldStopFetch(arguments[0])) return;$2"
            }
        },
        // Clicking a gif whose remote source is gone should recover from the local backup
        // instead of sending a dead link. This guard runs before the default send / GifPaste's
        // paste (userplugin patches apply after built-ins), and only fires for broken gifs —
        // everything else falls through untouched.
        {
            find: "handleSelectGIF=",
            replacement: {
                match: /handleSelectGIF=(\i)=>\{/,
                replace: "$&if($self.handleBrokenSelect($1))return;"
            }
        },
        // Capture Discord's favorite-gifs proto updater (the thing the ⭐ button drives) so we
        // can add/remove favorites by arbitrary url during recovery rebase. Keyed on the stable
        // "favoriteGifs" string literal; fires the first time you favorite/unfavorite anything.
        {
            find: "updateAsync(\"favoriteGifs\"",
            replacement: {
                match: /(\i\.\i)\.updateAsync\("favoriteGifs"/,
                replace: "$self.captureFavUpdater($1),$1.updateAsync(\"favoriteGifs\""
            }
        },
    ],

    settings,


    start() {
        GifLibrary.refreshLibrary();
        CollectionManager.refreshCacheCollection();
        ensureDragStyle();
        ensureOutlineStyle();
        void loadPersistedFavorites();
        enableMediaStar();
        enableCaptionNavButton();

        addContextMenuPatch("message", addCollectionContextMenuPatch);
    },

    stop() {
        revokeAll();
        removeDragStyle();
        removeOutlineStyle();
        disableMediaStar();
        disableCaptionNavButton();
        removeContextMenuPatch("message", addCollectionContextMenuPatch);
    },
    flux: {
        // No ADD_FAVORITE_GIF action exists; favoriting emits a TRACK analytics event.
        // Best-effort eager cache; the render path is the reliable backbone.
        TRACK(e: any) {
            if (e?.event !== "gif_favorited") return;
            const p = e.properties ?? {};
            const url = p.url ?? p.gif_url ?? p.gifUrl ?? p.src;
            if (!url) return; // payload shape unknown/empty — render path will catch it
            void cacheGif({
                id: "", url,
                src: p.src ?? url,
                width: p.width ?? 0, height: p.height ?? 0
            }).catch(() => {});
        },
        // Detects when a recovered gif is actually sent, so we can rebase it to the new url.
        MESSAGE_CREATE(e: any) {
            onMessageCreate(e);
        }
    },

    // Captures the native favorite-gifs proto updater (from the capture patch above).
    captureFavUpdater(updater: any) {
        captureFavUpdaterImpl(updater);
    },

    CollectionManager,
    GifLibrary,

    sillyInstance: null as any,
    sillyContentInstance: null as any,

    get collections(): Collection[] {
        CollectionManager.refreshCacheCollection();
        return CollectionManager.cache_collections;
    },

    renderContent(instance) {
        // Hide collection members from the favorites grid + render favorites from disk + backfill cache.
        // props.favorites is the live favorites array (same source favGifSearch uses).
        if (Array.isArray(instance.props.favorites)) {
            this.sillyContentInstance = instance;
            // Reconcile the media-star's favorited-state set against the authoritative native
            // favorites list (catches favorites added/removed on another device).
            syncFavoritedUrls(instance.props.favorites.map((f: any) => f?.url).filter(Boolean));
            const inCol = collectionKeySet();
            const favKeys = new Set<string>();
            const out: any[] = [];
            for (const fav of instance.props.favorites) {
                const key = getGifKey(fav.url);
                favKeys.add(key);
                // Maintain backup + health for ALL favorites — including collection members,
                // which stay native favorites — using the fresh signed url Discord gives us here.
                cacheGif(fav).then(newly => { if (newly) scheduleUpdate(instance); });
                healthCheck(fav);

                if (inCol.has(key)) continue;            // hidden from the grid (lives in a collection)

                const local = getObjectUrlSync(key);
                out.push(local ? { ...fav, src: local } : fav);
            }
            instance.props.favorites = out;
            // Snapshot what's favorited so the trashcan knows which cached gifs are orphaned.
            setFavoriteKeys(favKeys);
        }

        // Trash view: cached gifs no longer favorited / in a collection. These are LOCAL-only by
        // design — never emit a remote src (it would 404 on the dead cdn url). Render only items
        // whose local blob is ready; kick hydration for the rest so they appear next render.
        if (instance.props.query === TRASH_CATEGORY_NAME) {
            this.sillyContentInstance = instance;
            instance.props.resultItems = getOrphans().map(r => {
                const local = getObjectUrlSync(r.key);
                if (!local) {
                    // disk read ONLY — never download (trash is local-by-design, no requests)
                    getObjectUrl(r).then(url => { if (url) scheduleUpdate(instance); });
                    return null; // not hydrated yet — skip until the local blob is ready
                }
                return { id: r.key, format: r.format, src: local, url: r.url, width: r.width, height: r.height };
            }).filter(Boolean).reverse();
            return;
        }

        // Collection view: swap in the collection's gifs, rendered from disk.
        // Collections are matched by exact name (the clicked category name lands in the query).
        const collection = instance.props.query ? this.collections.find(c => c.name === instance.props.query) : undefined;
        if (collection) {
            this.sillyContentInstance = instance;
            instance.props.resultItems = collection.gifs.map(g => {
                const key = getGifKey(g.url);
                const local = getObjectUrlSync(key);
                if (!local) cacheGif(g).then(newly => { if (newly) scheduleUpdate(instance); });
                return {
                    id: g.id,
                    format: getFormat(g.src),
                    src: local ?? g.src,
                    url: g.url,
                    width: g.width,
                    height: g.height
                };
            }).reverse();
        }
    },

    insertCollections(instance: { props: Props; }) {
        try {
            this.sillyInstance = instance;
            // Render each collection's cover from the local cache. The stored cover src is a
            // signature-stripped CDN url that 404s as an <img>; prefer the local blob, fall
            // back to the durable (non-CDN) src or the placeholder so we never request a dead url.
            const cats: any[] = [];

            // Regular collections, in explicit `order`.
            for (const c of sortedRegularCollections(this.collections)) {
                const cover = c.gifs[c.gifs.length - 1];
                if (!cover) { cats.push(c); continue; }
                const key = getGifKey(cover.url);
                const local = getObjectUrlSync(key);
                if (!local) cacheGif(cover).then(newly => { if (newly) scheduleUpdate(instance); });
                const fallback = classifyHost(cover.url) === "cdn" ? settings.store.defaultEmptyCollectionImage : c.src;
                cats.push({ ...c, src: local ?? fallback });
            }

            // Append the trashcan (cached gifs no longer favorited / in a collection), if any.
            // Also append it when there are NO collections at all — even with an empty trash:
            // Discord's category grid gates off (and drops the native Favorites tile with it)
            // when trendingCategories is empty, so we always keep at least one tile so Favorites
            // still renders for a fresh / collection-less user.
            const orphans = getOrphans();
            if (orphans.length || cats.length === 0) {
                const coverRec = orphans[orphans.length - 1];
                cats.push({
                    type: "Category",
                    name: TRASH_CATEGORY_NAME,
                    src: (coverRec && getObjectUrlSync(coverRec.key)) || settings.store.defaultEmptyCollectionImage,
                    format: coverRec?.format,
                    gifs: []
                });
            }

            instance.props.trendingCategories = cats;
        } catch (err) {
            console.error(err);
        }
    },

    shouldStopFetch(query: string) {
        // A query matching a collection name (or the trashcan) is a category click, not a search.
        return query === TRASH_CATEGORY_NAME || (query != null && this.collections.some(c => c.name === query));
    },

    // Returns true (and starts recovery) when the clicked gif's remote source is confirmed gone
    // but we have a local backup — so the click reuploads from disk instead of sending a dead link.
    handleBrokenSelect(gif: { url?: string; }) {
        if (!gif?.url) return false;
        const rec = GifLibrary.getRecord(getGifKey(gif.url));
        if (rec?.status === "gone" && rec.localExt) {
            void recoverGif(rec);
            return true;
        }
        return false;
    },

    // Right-click toggle: manually mark a gif's CDN source as gone (forces recover-on-click)
    // or clear that flag if it was set in error. A manual override of the 24h health check.
    toggleForget(record: GifRecord) {
        GifLibrary.setStatus(record.key, record.status === "gone" ? "ok" : "gone");
        this.sillyContentInstance?.forceUpdate?.();
        this.sillyInstance?.forceUpdate?.();
    },

    // Shared gif right-click actions (used for favorites AND collection gifs): add-to-collection,
    // recover/reupload from backup, and force-forget. Returns an array of Menu items (+ nulls,
    // which React ignores).
    // Returns the format-outline CSS class for a picker tile (empty string = no outline).
    // gif -> no outline; video -> blue; image -> green. Class names are prefixed so they
    // match the injected stylesheet (ensureOutlineStyle) and don't collide with Discord's.
    formatClass(item: any): "" | "img" | "vid" {
        if (!settings.store.showFormatOutlines || !item?.url) return "";
        const rec = GifLibrary.getRecord(getGifKey(item.url));
        const cls = classifyMedia(item.url, rec?.localExt);
        return cls === "gif" ? "" : cls; // gif = no outline; value goes in the data-gifmgr-fmt attribute
    },

    gifActionItems(item: any) {
        const record = item?.url ? GifLibrary.getRecord(getGifKey(item.url)) : undefined;
        return [
            MenuThingy({ gif: { ...item, id: uuidv4() } }),
            <Menu.MenuItem
                key="add-caption"
                id="add-caption"
                label="Add Caption"
                action={async () => {
                    const src = await loadSource(item);
                    if (src) openCaptionEditor(src);
                    else Toasts.show({ message: "Couldn't load this media", type: Toasts.Type.FAILURE, id: Toasts.genId(), options: { duration: 3000, position: Toasts.Position.BOTTOM } });
                }}
            />,
            // Offer convert for anything that ISN'T already a gif — videos (→ animated gif) and
            // static images (→ 1-frame gif). Classify directly (not this.formatClass, which is
            // gated by the outline setting) so it stays available regardless of settings.
            item?.url && classifyMedia(item.url, record?.localExt) !== "gif"
                ? <Menu.MenuItem
                    key="convert-gif"
                    id="convert-gif"
                    label="Convert & Paste as GIF"
                    action={async () => {
                        const src = await loadSource(item);
                        if (src) await convertAndStage(src.blob, src.ext);
                        else Toasts.show({ message: "Couldn't load this media", type: Toasts.Type.FAILURE, id: Toasts.genId(), options: { duration: 3000, position: Toasts.Position.BOTTOM } });
                    }}
                />
                : null,
            record?.localExt
                ? <Menu.MenuItem
                    key="reupload-from-backup"
                    id="reupload-from-backup"
                    label={record.status === "gone" ? "Recover From Backup" : "Reupload From Backup"}
                    action={() => recoverGif(record)}
                />
                : null,
            record
                ? <Menu.MenuItem
                    key="toggle-forget-cdn"
                    id="toggle-forget-cdn"
                    color={record.status === "gone" ? undefined : "danger"}
                    label={record.status === "gone" ? "Unmark — CDN Is Fine" : "Force-Forget CDN (mark gone)"}
                    action={() => this.toggleForget(record)}
                />
                : null
        ];
    },

    onItemMouseDown(e: React.MouseEvent, instance: any) {
        if (e.button !== 0) return;
        const item = instance?.props?.item;
        if (!item) return;
        const sourceEl = e.currentTarget as HTMLElement;

        // (A) Gif tile inside an open collection view (never Trash / favorites / search).
        if (item.id && item.url && item.name == null) {
            const contentInst = this.sillyContentInstance;
            const collectionName: string | undefined = contentInst?.props?.query;
            if (!collectionName || collectionName === TRASH_CATEGORY_NAME) return;
            if (!this.collections.some(c => c.name === collectionName)) return;
            startDragReorder({
                startX: e.clientX, startY: e.clientY, button: e.button, sourceEl,
                onDrop: (x, y) => {
                    const target = getItemFromNode(document.elementFromPoint(x, y));
                    // Target must be another gif tile (has url+id), not a category.
                    if (target?.url && target.id && target.id !== item.id)
                        CollectionManager.reorderGif(collectionName, item.id, target.id).then(() => contentInst?.forceUpdate?.());
                }
            });
            return;
        }

        // (B) Collection tile in the categories row (regular collections only; not reserved).
        if (item.name && !isReservedName(item.name) && this.collections.some(c => c.name === item.name)) {
            const catsInst = this.sillyInstance;
            startDragReorder({
                startX: e.clientX, startY: e.clientY, button: e.button, sourceEl,
                onDrop: (x, y) => {
                    const target = getItemFromNode(document.elementFromPoint(x, y));
                    const targetName = target?.name;
                    if (targetName && !isReservedName(targetName) && targetName !== item.name && this.collections.some(c => c.name === targetName))
                        CollectionManager.reorderCollection(item.name, targetName).then(() => catsInst?.forceUpdate?.());
                }
            });
        }
    },

    collectionContextMenu(e: React.UIEvent, instance) {
        const { item } = instance.props;
        if (item?.name && this.collections.some(c => c.name === item.name)) {
            if (isReservedName(item.name)) return; // media favorites: not renamable/deletable
            const refresh = () => { this.sillyInstance && this.sillyInstance.forceUpdate(); };
            return ContextMenuApi.openContextMenu(e, () =>
                <Menu.Menu navId="gif-collection-id" onClose={() => FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" })} aria-label="Collection">
                    <Menu.MenuItem
                        key="rename-collection" id="rename-collection" label="Rename Collection"
                        action={() => openModal(mp => <RenameCollectionModal currentName={item.name} onClose={mp.onClose} modalProps={mp} />)}
                    />
                    <Menu.MenuItem
                        key="delete-collection" id="delete-collection" color="danger" label="Delete Collection"
                        action={() => Alerts.show({
                            title: "Are you sure?",
                            body: "Do you really want to delete this collection?",
                            confirmText: "Delete",
                            confirmColor: Button.Colors.RED,
                            cancelText: "Nevermind",
                            onConfirm: async () => { await CollectionManager.deleteCollection(item.name); refresh(); }
                        })}
                    />
                </Menu.Menu>
            );
        }
        if (item?.id?.startsWith(GIF_ITEM_PREFIX)) {
            const refresh = () => {
                instance.props.focused = false;
                instance.forceUpdate();
                this.sillyContentInstance && this.sillyContentInstance.forceUpdate();
            };
            return ContextMenuApi.openContextMenu(e, () =>
                <Menu.Menu
                    navId="gif-collection-id"
                    onClose={() => FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" })}
                    aria-label="Gif"
                >
                    {/* same actions as the favorites menu — a collection gif is hidden from favorites */}
                    {this.gifActionItems(item)}
                    <Menu.MenuSeparator />
                    <Menu.MenuItem
                        key="remove-from-collection"
                        id="remove-from-collection"
                        color="danger"
                        label="Remove From Collection"
                        action={() => CollectionManager.removeFromCollection(item.id).then(refresh)}
                    />
                </Menu.Menu>
            );
        }

        // Trashcan item: a cached gif that's no longer favorited / in a collection.
        if (item?.url && isOrphan(getGifKey(item.url))) {
            const record = GifLibrary.getRecord(getGifKey(item.url))!;
            const refresh = () => { this.sillyContentInstance?.forceUpdate?.(); this.sillyInstance?.forceUpdate?.(); };
            return ContextMenuApi.openContextMenu(e, () =>
                <Menu.Menu
                    navId="gif-collection-id"
                    onClose={() => FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" })}
                    aria-label="Trash"
                >
                    <Menu.MenuItem
                        key="trash-restore" id="trash-restore" label="Restore To Favorites"
                        action={() => { nativeFavorite({ id: "", url: record.url, src: record.url, width: record.width, height: record.height }); refresh(); }}
                    />
                    <Menu.MenuItem
                        key="trash-resend" id="trash-resend" label="Send From Backup"
                        action={() => recoverGif(record)}
                    />
                    <Menu.MenuItem
                        key="trash-delete" id="trash-delete" color="danger" label="Delete Permanently"
                        action={() => { deleteOrphan(record).then(refresh); }}
                    />
                </Menu.Menu>
            );
        }

        const { src, url, height, width } = item;
        if (src && url && height != null && width != null && !item.id?.startsWith(GIF_ITEM_PREFIX)) {
            return ContextMenuApi.openContextMenu(e, () =>
                <Menu.Menu
                    navId="gif-collection-id"
                    onClose={() => FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" })}
                    aria-label="Gif Collections"
                >
                    {this.gifActionItems(item)}
                </Menu.Menu>
            );
        }
        return null;
    },
});



const MenuThingy: React.FC<{ gif: Gif; }> = ({ gif }) => {
    CollectionManager.refreshCacheCollection();
    const collections = CollectionManager.cache_collections;

    return (
        <Menu.MenuItem
            label="Add To Collection"
            key="add-to-collection"
            id="add-to-collection"
        >
            {collections.map(col => (
                <Menu.MenuItem
                    key={col.name}
                    id={col.name}
                    label={col.name}
                    action={() => CollectionManager.addToCollection(col.name, gif)}
                />
            ))}

            <Menu.MenuSeparator />
            <Menu.MenuItem
                key="create-collection"
                id="create-collection"
                label="Create Collection"
                action={() => {
                    openModal(modalProps => (
                        <CreateCollectionModal onClose={modalProps.onClose} gif={gif} modalProps={modalProps} />
                    ));
                }}
            />
        </Menu.MenuItem>
    );
};

interface CreateCollectionModalProps {
    gif: Gif;
    onClose: () => void,
    modalProps: ModalProps;
}

function CreateCollectionModal({ gif, onClose, modalProps }: CreateCollectionModalProps) {

    const [name, setName] = useState("");

    const onSubmit = useCallback((e: React.FormEvent<HTMLFormElement> | React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
        e.preventDefault();
        if (!name.length) return;
        CollectionManager.createCollection(name, [gif]);
        onClose();
    }, [name]);

    return (
        <ModalRoot {...modalProps}>
            <form onSubmit={onSubmit}>
                <ModalHeader>
                    <Forms.FormText>Create Collection</Forms.FormText>
                </ModalHeader>
                <ModalContent>
                    <Forms.FormTitle tag="h5" style={{ marginTop: "10px" }}>Collection Name</Forms.FormTitle>
                    <TextInput onChange={(e: string) => setName(e)} />
                </ModalContent>
                <div style={{ marginTop: "1rem" }}>
                    <ModalFooter>
                        <Button
                            type="submit"
                            color={Button.Colors.GREEN}
                            disabled={!name.length}
                            onClick={onSubmit}
                        >
                            Create
                        </Button>
                    </ModalFooter>
                </div>
            </form>
        </ModalRoot>
    );
}

function RenameCollectionModal({ currentName, onClose, modalProps }: { currentName: string; onClose: () => void; modalProps: ModalProps; }) {
    const [name, setName] = useState(currentName);

    const onSubmit = useCallback(async (e: React.FormEvent<HTMLFormElement> | React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
        e.preventDefault();
        if (!name.trim().length) return;
        const ok = await CollectionManager.renameCollection(currentName, name.trim());
        if (ok) onClose();
    }, [name, currentName]);

    return (
        <ModalRoot {...modalProps}>
            <form onSubmit={onSubmit}>
                <ModalHeader><Forms.FormText>Rename Collection</Forms.FormText></ModalHeader>
                <ModalContent>
                    <Forms.FormTitle tag="h5" style={{ marginTop: "10px" }}>New Name</Forms.FormTitle>
                    <TextInput value={name} onChange={(e: string) => setName(e)} />
                </ModalContent>
                <div style={{ marginTop: "1rem" }}>
                    <ModalFooter>
                        <Button type="submit" color={Button.Colors.GREEN} disabled={!name.trim().length} onClick={onSubmit}>Rename</Button>
                    </ModalFooter>
                </div>
            </form>
        </ModalRoot>
    );
}



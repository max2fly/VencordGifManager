/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A hover "favorite" star overlaid on images/videos in chat — the parity feature for gifs (which
// already get a native ⭐). Injected via DOM (no fragile component patch): a single fixed-position
// star follows whichever media the cursor is over; clicking toggles Discord's REAL favorite /
// unfavorite functions, so the media lands in the native Favorites tab exactly like a gif. A single
// fixed star (rather than one appended per media) avoids per-wrapper overflow/:hover quirks that
// otherwise hid it on video/gif wrappers. Covers embed videos (e.g. vxtwitter) too, reading the
// real url from the element's React props when the DOM src is a blob.
//
// Favorited state is tracked in a session Set keyed by url pathname (robust to host/query/signature
// differences): Discord's favorites getter is a render-only hook we can't call synchronously, so we
// record what we toggle AND seed the set from the gif picker's favorites list (see noteFavoritedUrls).

import { DataStore } from "@api/index";

import { cacheGif } from "./favorites";
import { nativeFavoriteReal, nativeUnfavoriteReal } from "./nativeFavorites";

const STYLE_ID = "gifmgr-star-style";
const STAR_CLASS = "gifmgr-fav-star";
const ON_CLASS = "gifmgr-fav-star--on";
const VISIBLE_CLASS = "gifmgr-fav-star--visible";

type Media = HTMLImageElement | HTMLVideoElement;

// Record of favorited media, by url pathname. Persisted so the star shows correct filled/hollow
// state on startup WITHOUT needing to open the gif picker — the picker render reconciles it against
// Discord's authoritative list (catching changes made on another device).
const favedPaths = new Set<string>();
const pathOf = (u: string): string => {
    try { return new URL(u).pathname.replace(/\/+$/, ""); } catch { return u; }
};

const FAV_STORE_KEY = "gif-manager-fav-media-paths";
let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persist(): void {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
        persistTimer = null;
        DataStore.set(FAV_STORE_KEY, [...favedPaths]).catch(() => { });
    }, 500);
}

/** Load the persisted favorited-state set (called from the plugin start). */
export async function loadPersistedFavorites(): Promise<void> {
    try {
        const arr = await DataStore.get<string[]>(FAV_STORE_KEY);
        if (Array.isArray(arr)) arr.forEach(p => favedPaths.add(p));
    } catch { /* first run / no data */ }
}

/** Reconcile the set against Discord's authoritative favorites list (from the gif picker render). */
export function syncFavoritedUrls(urls: string[]): void {
    favedPaths.clear();
    for (const u of urls) if (u) favedPaths.add(pathOf(u));
    persist();
}

let starEl: HTMLElement | null = null;
let currentMedia: Media | null = null;

function ensureStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent =
        `.${STAR_CLASS}{position:fixed;width:32px;height:32px;display:none;` +
        "align-items:center;justify-content:center;border-radius:8px;background:rgba(0,0,0,.55);" +
        "color:#fff;cursor:pointer;z-index:1000;font-size:24px;line-height:1;user-select:none;" +
        "transition:transform .1s,background .1s}" +
        `.${STAR_CLASS}.${VISIBLE_CLASS}{display:flex}` +
        `.${STAR_CLASS}::before{content:"\\2606"}` +               // ☆
        `.${STAR_CLASS}:hover{transform:scale(1.12);background:rgba(0,0,0,.78)}` +
        `.${STAR_CLASS}.${ON_CLASS}{color:#facc15}` +
        `.${STAR_CLASS}.${ON_CLASS}::before{content:"\\2605"}`;    // ★
    document.head.appendChild(s);
}

// Walk the element's React fiber for a real http url (used when a video's DOM src is a blob:).
function fiberMediaSrc(el: Element): string | null {
    const key = Object.keys(el).find(k => k.startsWith("__reactFiber$"));
    if (!key) return null;
    let fiber: any = (el as any)[key];
    for (let i = 0; fiber && i < 30; i++, fiber = fiber.return) {
        const p = fiber.memoizedProps;
        if (!p) continue;
        const cand = p.src ?? p.original ?? p.href ?? p.proxyUrl ?? p.proxyURL ?? p.originalSrc ?? p.videoUrl;
        if (typeof cand === "string" && /^https?:/.test(cand)) return cand;
    }
    return null;
}

interface Derived { url: string; src: string; width: number; height: number; format: number; }

function deriveMedia(el: Media): Derived | null {
    const isVideo = el instanceof HTMLVideoElement;
    let src = isVideo ? (el.currentSrc || el.src) : el.src;
    if (!src || src.startsWith("blob:") || src.startsWith("data:")) src = fiberMediaSrc(el) ?? "";
    if (!src || src.startsWith("blob:") || src.startsWith("data:")) return null;

    // Canonical url: strip query + normalize the proxy host to the durable CDN host.
    let url = src;
    try {
        const u = new URL(src);
        u.search = "";
        if (u.hostname === "media.discordapp.net") u.hostname = "cdn.discordapp.com";
        url = u.href;
    } catch { /* keep src */ }

    const width = isVideo ? el.videoWidth : el.naturalWidth;
    const height = isVideo ? el.videoHeight : el.naturalHeight;
    return { url, src, width: width || 0, height: height || 0, format: isVideo ? 2 : 1 };
}

// Animated-capable image formats Discord gif-treats (its own favorite button already shows on these).
const ANIMATED_EXT = new Set(["gif", "webp", "avif"]);

// A url points at animated/gif media if it's on a gif host (tenor, gif.* subdomains) or its PATH
// (ignoring query) ends in an animated-capable extension. Static png/jpg keep their own extension in
// the path (Discord's ?format=webp lives only in the query), so real photos are not caught here.
function isAnimatedUrl(u: string): boolean {
    try {
        const url = new URL(u);
        if (url.hostname.includes("tenor") || url.hostname.startsWith("gif.")) return true;
        return ANIMATED_EXT.has(url.pathname.split(".").pop()?.toLowerCase() ?? "");
    } catch {
        return /tenor|\/\/gif\./i.test(u) || /\.(gif|webp|avif)(\?|:|$)/i.test(u.split("?")[0]);
    }
}

// Gifs / animated media already have Discord's own favorite affordance in chat, so we skip them.
// Detect via the loop flag (gifs autoplay+loop; real videos don't), the media src/currentSrc, and
// the original url in the element's React props.
function looksLikeGif(el: Media): boolean {
    if (el instanceof HTMLVideoElement && el.loop) return true;
    for (const u of [el.src, el instanceof HTMLVideoElement ? el.currentSrc : "", fiberMediaSrc(el)]) {
        if (u && isAnimatedUrl(u)) return true;
    }
    const key = Object.keys(el).find(k => k.startsWith("__reactFiber$"));
    if (key) {
        let fiber: any = (el as any)[key];
        for (let i = 0; fiber && i < 30; i++, fiber = fiber.return) {
            const p = fiber.memoizedProps;
            if (!p) continue;
            if (p.type === "gifv" || p.gifv || p.isGIF || p.isGif || p.animated) return true;
            for (const f of [p.src, p.original, p.href, p.url, p.proxyUrl, p.proxyURL, p.videoUrl]) {
                if (typeof f === "string" && isAnimatedUrl(f)) return true;
            }
        }
    }
    return false;
}

// Only real message media — not emojis, avatars, stickers, gifs, the composer, or the gif picker.
function qualifies(media: Media): boolean {
    if ((media.clientWidth || 0) < 80 && (media.clientHeight || 0) < 80) return false;
    if (looksLikeGif(media)) return false;
    if (!media.closest('[class*="messageContent"], [class*="messageListItem"], [id^="chat-messages-"], [class*="imageContent"], [class*="embed"]')) return false;
    if (media instanceof HTMLImageElement) {
        const s = media.src || "";
        if (/\/(emojis|avatars|icons|stickers|role-icons|app-icons|banners|embed\/avatars|guilds\/\d+\/users)\//.test(s)) return false;
    }
    return true;
}

function getStar(): HTMLElement {
    if (starEl) return starEl;
    const el = document.createElement("div");
    el.className = STAR_CLASS;
    el.setAttribute("aria-label", "Favorite media");
    el.addEventListener("click", ev => {
        ev.preventDefault();
        ev.stopPropagation();
        if (currentMedia) toggle(currentMedia, el);
    });
    document.body.appendChild(el);
    starEl = el;
    return el;
}

function toggle(media: Media, btn: HTMLElement): void {
    const m = deriveMedia(media);
    if (!m) return;
    const p = pathOf(m.url);
    if (favedPaths.has(p)) {
        nativeUnfavoriteReal(m.url);
        favedPaths.delete(p);
        btn.classList.remove(ON_CLASS);
    } else {
        nativeFavoriteReal({ id: "", url: m.url, src: m.src, width: m.width, height: m.height, format: m.format });
        void cacheGif({ id: "", url: m.url, src: m.src, width: m.width, height: m.height });
        favedPaths.add(p);
        btn.classList.add(ON_CLASS);
    }
    persist();
}

const OFFSET = 6; // px inset of the star from the media's top-left corner

// Position the star over `media`; returns false if the media is off-screen / detached (→ hide).
function positionStar(star: HTMLElement, media: Media): boolean {
    const r = media.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.bottom <= 0 || r.top >= window.innerHeight) return false;
    star.style.left = `${Math.round(r.left + OFFSET)}px`;
    star.style.top = `${Math.round(r.top + OFFSET)}px`;
    return true;
}

function showStarFor(media: Media): void {
    const star = getStar();
    if (!positionStar(star, media)) { hideStar(); return; }
    currentMedia = media;
    const m = deriveMedia(media);
    star.classList.toggle(ON_CLASS, !!m && favedPaths.has(pathOf(m.url)));
    star.classList.add(VISIBLE_CLASS);
}

function hideStar(): void {
    currentMedia = null;
    starEl?.classList.remove(VISIBLE_CLASS);
}

// Keep the star glued to its media as the message list scrolls; drop it once the media leaves view.
function onScroll(): void {
    if (!currentMedia || !starEl?.classList.contains(VISIBLE_CLASS)) return;
    if (!positionStar(starEl, currentMedia)) hideStar();
}

function onPointerOver(e: MouseEvent): void {
    const stack = document.elementsFromPoint(e.clientX, e.clientY);
    if (starEl && stack.includes(starEl)) return; // hovering the star itself — keep it up
    const media = stack.find(el => el instanceof HTMLImageElement || el instanceof HTMLVideoElement) as Media | undefined;
    if (media && qualifies(media)) showStarFor(media);
    else hideStar();
}

export function enableMediaStar(): void {
    ensureStyle();
    document.addEventListener("mouseover", onPointerOver, true);
    document.addEventListener("scroll", onScroll, true);
}

export function disableMediaStar(): void {
    document.removeEventListener("mouseover", onPointerOver, true);
    document.removeEventListener("scroll", onScroll, true);
    document.getElementById(STYLE_ID)?.remove();
    starEl?.remove();
    starEl = null;
    currentMedia = null;
}

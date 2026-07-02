/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Masonry-safe pointer drag with a visual ghost. We DON'T rely on DOM sibling order (the picker
// grid is a column masonry) — the caller resolves the drop target from the release coordinates
// (see getItemFromNode). A drag only "counts" once the pointer moves past THRESHOLD, so an ordinary
// click still sends the gif; on a real drag we swallow the trailing click so send/GifPaste doesn't
// fire.
const THRESHOLD = 5;
const STYLE_ID = "gifmgr-drag-style";

// Injected once (from the plugin start()). Keeps the ghost styling self-contained.
export function ensureDragStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent =
        ".gifmgr-drag-ghost{position:fixed;pointer-events:none;z-index:10000;width:90px;height:90px;" +
        "margin-left:12px;margin-top:12px;opacity:.85;border-radius:8px;overflow:hidden;" +
        "box-shadow:0 4px 14px rgba(0,0,0,.55);background:var(--background-secondary,#2b2d31)}" +
        ".gifmgr-drag-ghost img,.gifmgr-drag-ghost video{width:100%;height:100%;object-fit:cover}" +
        ".gifmgr-drag-source{opacity:.4!important}";
    document.head.appendChild(s);
}

export function removeDragStyle(): void {
    document.getElementById(STYLE_ID)?.remove();
}

interface DragOpts {
    startX: number;
    startY: number;
    button: number;
    /** The tile element the drag started on (e.currentTarget); used to build the ghost + dim it. */
    sourceEl: HTMLElement | null;
    onDrop: (x: number, y: number) => void;
}

export function startDragReorder({ startX, startY, button, sourceEl, onDrop }: DragOpts): void {
    if (button !== 0) return; // left button only
    let dragging = false;
    let ghost: HTMLElement | null = null;

    const makeGhost = () => {
        const g = document.createElement("div");
        g.className = "gifmgr-drag-ghost";
        // Clone the actual media element so the ghost matches the tile: gifs render as <video>
        // (an <img src="video-blob"> would show a broken-image icon), static images as <img>.
        const media = sourceEl?.querySelector("img, video") as HTMLImageElement | HTMLVideoElement | null;
        if (media) {
            const clone = media.cloneNode(true) as HTMLElement;
            if (clone instanceof HTMLVideoElement) { clone.muted = true; clone.play?.().catch(() => { }); }
            g.appendChild(clone);
        } else if (sourceEl) {
            g.appendChild(sourceEl.cloneNode(true));
        }
        document.body.appendChild(g);
        return g;
    };

    const positionGhost = (x: number, y: number) => {
        if (ghost) { ghost.style.left = `${x}px`; ghost.style.top = `${y}px`; }
    };

    const cleanup = () => {
        document.body.style.cursor = "";
        sourceEl?.classList.remove("gifmgr-drag-source");
        ghost?.remove();
        ghost = null;
    };

    const move = (ev: MouseEvent) => {
        if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) > THRESHOLD) {
            dragging = true;
            document.body.style.cursor = "grabbing";
            sourceEl?.classList.add("gifmgr-drag-source");
            ghost = makeGhost();
        }
        if (dragging) positionGhost(ev.clientX, ev.clientY);
    };

    const swallowClick = (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        document.removeEventListener("click", swallowClick, true);
    };

    // <img>/<video> tiles are natively draggable — the browser would start its OWN drag-and-drop
    // (a ghost that needs a click to drop), hijacking our pointer flow. Suppress it for the gesture.
    const preventNativeDrag = (ev: Event) => ev.preventDefault();

    const teardownListeners = () => {
        document.removeEventListener("mousemove", move, true);
        document.removeEventListener("mouseup", up, true);
        document.removeEventListener("dragstart", preventNativeDrag, true);
    };

    const up = (ev: MouseEvent) => {
        teardownListeners();
        if (!dragging) { cleanup(); return; } // was a click, not a drag — let it send
        ev.preventDefault();
        ev.stopPropagation();
        document.addEventListener("click", swallowClick, true); // eat the click this mouseup spawns
        cleanup(); // remove ghost BEFORE resolving the target so it can't shadow elementFromPoint
        onDrop(ev.clientX, ev.clientY);
    };

    document.addEventListener("mousemove", move, true);
    document.addEventListener("mouseup", up, true);
    document.addEventListener("dragstart", preventNativeDrag, true);
}

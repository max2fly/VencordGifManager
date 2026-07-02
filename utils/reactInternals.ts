/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Read the React `props.item` off the DOM node under the cursor by walking its fiber chain.
// This resolves a drag drop-target WITHOUT depending on the rendered media/cover `src` — src
// matching fails for non-CDN hosts (e.g. klippy.com, whose url can't be normalized) and for
// category tiles whose cover is a CSS background-image (no <img> to read). The tile's component
// holds the same `item` object we get in onMouseDown (gif items have id+url; category tiles have
// name), so reading it directly is host- and layout-agnostic.
export function getItemFromNode(node: Element | null): any | null {
    let el: Element | null = node;
    // Ascend a few DOM levels in case the cursor is over a child (text / overlay) whose own fiber
    // has no `item`.
    for (let depth = 0; el && depth < 20; depth++, el = el.parentElement) {
        const fiberKey = Object.keys(el).find(k => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
        if (!fiberKey) continue;
        let fiber: any = (el as any)[fiberKey];
        for (let hop = 0; fiber && hop < 30; hop++, fiber = fiber.return) {
            const item = fiber.memoizedProps?.item;
            if (item && (item.id != null || item.name != null)) return item;
        }
    }
    return null;
}

/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Pure geometry for the Paint-like caption editor. Every layer (the media, each text box) has a
// center-based Transform in OUTPUT-canvas pixels; the same math drives interaction hit-testing,
// on-screen selection handles, and the exported compositing — so preview and output never drift.

export type Transform = {
    cx: number;   // center x, output px
    cy: number;   // center y, output px
    scale: number; // uniform scale applied to the layer's intrinsic (w,h)
    rot: number;  // rotation, radians
};

export interface Pt { x: number; y: number; }

/** Map a layer-local point (origin at the layer center, unscaled) to world/output space. */
export function localToWorld(t: Transform, lx: number, ly: number): Pt {
    const cos = Math.cos(t.rot), sin = Math.sin(t.rot);
    return {
        x: t.cx + t.scale * (lx * cos - ly * sin),
        y: t.cy + t.scale * (lx * sin + ly * cos)
    };
}

/** Map a world/output point into layer-local space (origin at the layer center, unscaled). */
export function worldToLocal(t: Transform, px: number, py: number): Pt {
    const cos = Math.cos(t.rot), sin = Math.sin(t.rot);
    const dx = px - t.cx, dy = py - t.cy;
    const s = t.scale || 1;
    return {
        x: (dx * cos + dy * sin) / s,
        y: (-dx * sin + dy * cos) / s
    };
}

/** The four world-space corners of a layer whose intrinsic size is w×h (order: TL, TR, BR, BL). */
export function corners(t: Transform, w: number, h: number): Pt[] {
    const hw = w / 2, hh = h / 2;
    return [
        localToWorld(t, -hw, -hh),
        localToWorld(t, hw, -hh),
        localToWorld(t, hw, hh),
        localToWorld(t, -hw, hh)
    ];
}

/** True when world point (px,py) is inside the layer's rotated/scaled w×h box. */
export function pointInLayer(t: Transform, w: number, h: number, px: number, py: number): boolean {
    const l = worldToLocal(t, px, py);
    return Math.abs(l.x) <= w / 2 && Math.abs(l.y) <= h / 2;
}

export interface Sized { t: Transform; w: number; h: number; }

/** Index of the TOPMOST layer (last in paint order) containing the point, or -1. */
export function hitTestTop(layers: Sized[], px: number, py: number): number {
    for (let i = layers.length - 1; i >= 0; i--) {
        if (pointInLayer(layers[i].t, layers[i].w, layers[i].h, px, py)) return i;
    }
    return -1;
}

/** New scale so the layer's half-diagonal handle follows the pointer during a corner drag. */
export function scaleForHandle(t: Transform, w: number, h: number, px: number, py: number): number {
    const l = worldToLocal(t, px, py);          // pointer in local (already unscaled by current scale)
    const halfDiag = Math.hypot(w / 2, h / 2) || 1;
    const pointerDiag = Math.hypot(l.x, l.y);
    return Math.max(0.05, (pointerDiag / halfDiag) * t.scale);
}

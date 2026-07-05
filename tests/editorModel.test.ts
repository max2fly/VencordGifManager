/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";

import { corners, hitTestTop, localToWorld, pointInLayer, scaleForHandle, Transform, worldToLocal } from "../utils/editorModel";

const approx = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

// --- identity-ish transform, no rotation ---
const t0: Transform = { cx: 100, cy: 100, scale: 1, rot: 0 };
// a 40x20 box centered at (100,100): x in [80,120], y in [90,110]
assert.equal(pointInLayer(t0, 40, 20, 100, 100), true);   // center
assert.equal(pointInLayer(t0, 40, 20, 119, 109), true);   // inside corner
assert.equal(pointInLayer(t0, 40, 20, 121, 100), false);  // just past right
assert.equal(pointInLayer(t0, 40, 20, 100, 111), false);  // just past bottom

// --- localToWorld / worldToLocal are inverses ---
const t1: Transform = { cx: 50, cy: 70, scale: 2, rot: Math.PI / 3 };
const w = localToWorld(t1, 13, -7);
const back = worldToLocal(t1, w.x, w.y);
approx(back.x, 13, 1e-9); approx(back.y, -7, 1e-9);

// --- 90° rotation swaps the effective width/height ---
const t90: Transform = { cx: 0, cy: 0, scale: 1, rot: Math.PI / 2 };
const p = localToWorld(t90, 10, 0); // local +x rotates to world +y
approx(p.x, 0, 1e-9); approx(p.y, 10, 1e-9);
// a 40(w)x20(h) box rotated 90° occupies 20 wide, 40 tall in world
assert.equal(pointInLayer(t90, 40, 20, 0, 19), true);   // 19 < 40/2 tall extent
assert.equal(pointInLayer(t90, 40, 20, 11, 0), false);  // 11 > 20/2 wide extent
assert.equal(pointInLayer(t90, 40, 20, 9, 0), true);

// --- corners: unrotated box gives the expected axis-aligned rect (TL,TR,BR,BL) ---
const c = corners(t0, 40, 20);
approx(c[0].x, 80); approx(c[0].y, 90);
approx(c[1].x, 120); approx(c[1].y, 90);
approx(c[2].x, 120); approx(c[2].y, 110);
approx(c[3].x, 80); approx(c[3].y, 110);

// --- hitTestTop returns the TOPMOST (last) overlapping layer ---
const layers = [
    { t: { cx: 100, cy: 100, scale: 1, rot: 0 }, w: 80, h: 80 }, // bottom, big
    { t: { cx: 100, cy: 100, scale: 1, rot: 0 }, w: 20, h: 20 }  // top, small
];
assert.equal(hitTestTop(layers, 100, 100), 1);  // both contain center -> topmost (index 1)
assert.equal(hitTestTop(layers, 130, 100), 0);  // only the big one
assert.equal(hitTestTop(layers, 200, 200), -1); // neither

// --- scaleForHandle: dragging the corner to twice its half-diagonal doubles the scale ---
const ts: Transform = { cx: 0, cy: 0, scale: 1, rot: 0 };
// half-diagonal of a 40x20 box = hypot(20,10); a pointer at 2x that along the diagonal -> scale ~2
const hw = 20, hh = 10;
const s = scaleForHandle(ts, 40, 20, 2 * hw, 2 * hh);
approx(s, 2, 1e-9);

console.log("editorModel tests passed");

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

import assert from "node:assert/strict";

import { CanvasLike, CaptionLayout, drawCaption, drawTextLayer, measureTextLayer, TextStyle, wrapText } from "../utils/caption";

// Fake 2D context: measureText width = chars * 10 (deterministic), records draw calls.
function fakeCtx() {
    const fills: string[] = [];
    const strokes: string[] = [];
    const order: string[] = [];
    const ctx: CanvasLike = {
        font: "", textAlign: "left", textBaseline: "alphabetic",
        fillStyle: "", strokeStyle: "", lineWidth: 0, lineJoin: "miter",
        measureText: (t: string) => ({ width: t.length * 10 }),
        fillText: (t: string) => { fills.push(t); order.push("fill:" + t); },
        strokeText: (t: string) => { strokes.push(t); order.push("stroke:" + t); },
        fillRect: () => { order.push("rect"); }
    };
    return { ctx, fills, strokes, order };
}

function style(over: Partial<TextStyle> = {}): TextStyle {
    return { text: "hi", boxW: 200, fontPx: 20, font: "Impact", bold: false, italic: false, color: "#fff", outline: true, outlineW: 0.14, align: "center", ...over };
}

// wrapText: greedy word wrap to maxWidth (char*10).
{
    const { ctx } = fakeCtx();
    // "aa bb cc" -> widths: "aa"=20, "aa bb"=50, "aa bb cc"=80. maxWidth 55 -> ["aa bb","cc"]
    assert.deepEqual(wrapText(ctx, "aa bb cc", 55), ["aa bb", "cc"]);
    // everything fits
    assert.deepEqual(wrapText(ctx, "aa bb", 999), ["aa bb"]);
    // single word longer than maxWidth is hard-broken (not dropped)
    const broken = wrapText(ctx, "aaaaaa", 25); // 6 chars *10 = 60 > 25
    assert.ok(broken.length >= 2, "long word must hard-break");
    assert.equal(broken.join(""), "aaaaaa");
}

// drawCaption: outline stroked BEFORE fill for each line (so fill sits on top).
{
    const { ctx, order } = fakeCtx();
    const layout: CaptionLayout = {
        boxes: [{
            id: "1", kind: "meme", text: "hi", x: 0.5, y: 0.02, w: 0.9,
            fontScale: 0.1, color: "#fff", outline: true, align: "center"
        }]
    };
    drawCaption(ctx, layout, 200, 200);
    // kind:"meme" uppercases text before rendering (impact-font meme caption convention)
    assert.deepEqual(order, ["stroke:HI", "fill:HI"]);
}

// drawCaption: outline:false emits no stroke.
{
    const { ctx, strokes } = fakeCtx();
    const layout: CaptionLayout = {
        boxes: [{ id: "1", kind: "free", text: "yo", x: 0.1, y: 0.1, w: 0.5,
            fontScale: 0.08, color: "#000", outline: false, align: "left" }]
    };
    drawCaption(ctx, layout, 300, 300);
    assert.equal(strokes.length, 0);
}

// measureTextLayer: wraps to boxW and reports line count -> intrinsic height.
{
    const { ctx } = fakeCtx();
    // "aa bb cc" at boxW 55 -> 2 lines; h = 2 * fontPx(20) * 1.2 = 48
    const m = measureTextLayer(ctx, style({ text: "aa bb cc", boxW: 55, fontPx: 20 }));
    assert.deepEqual(m.lines, ["aa bb", "cc"]);
    assert.equal(m.w, 55);
    assert.equal(m.h, 48);
}

// drawTextLayer: per line, highlight rect (if any) -> stroke (if outline) -> fill, in that order.
{
    const { ctx, order } = fakeCtx();
    drawTextLayer(ctx, style({ text: "hi", outline: true, highlight: "#000" }));
    assert.deepEqual(order, ["rect", "stroke:hi", "fill:hi"]);
}

// drawTextLayer: outline:false and no highlight -> fill only.
{
    const { ctx, order, strokes } = fakeCtx();
    drawTextLayer(ctx, style({ text: "yo", outline: false, highlight: undefined }));
    assert.equal(strokes.length, 0);
    assert.deepEqual(order, ["fill:yo"]);
}

// drawTextLayer: does NOT uppercase (unlike the old meme drawCaption) — user controls case now.
{
    const { ctx, fills } = fakeCtx();
    drawTextLayer(ctx, style({ text: "Hello", outline: false }));
    assert.deepEqual(fills, ["Hello"]);
}

console.log("caption tests passed");

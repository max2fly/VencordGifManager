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

export type CanvasLike = {
    font: string;
    textAlign: CanvasTextAlign;
    textBaseline: CanvasTextBaseline;
    fillStyle: string;
    strokeStyle: string;
    lineWidth: number;
    lineJoin: CanvasLineJoin;
    measureText(text: string): { width: number; };
    fillText(text: string, x: number, y: number): void;
    strokeText(text: string, x: number, y: number): void;
    fillRect(x: number, y: number, w: number, h: number): void;
};

export type CaptionBox = {
    id: string;
    kind: "meme" | "free";
    text: string;
    x: number;         // 0..1 anchor x (meme: horizontal center; free: left edge)
    y: number;         // 0..1 top of the box
    w: number;         // 0..1 wrap width as a fraction of source width
    fontScale: number; // font size as a fraction of source height
    color: string;
    outline: boolean;
    align: "left" | "center" | "right";
};

export type CaptionLayout = { boxes: CaptionBox[]; };

export const MEME_FONT = 'impact, "Arial Black", "Anton", sans-serif';

/** Greedy word-wrap to `maxWidth` px; hard-breaks any single word wider than maxWidth. */
export function wrapText(ctx: CanvasLike, text: string, maxWidth: number): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split("\n")) {
        const words = paragraph.split(/\s+/).filter(Boolean);
        let line = "";
        for (let word of words) {
            // hard-break a word that cannot fit on its own line
            while (ctx.measureText(word).width > maxWidth && word.length > 1) {
                let i = word.length;
                while (i > 1 && ctx.measureText(word.slice(0, i)).width > maxWidth) i--;
                const head = word.slice(0, i);
                if (line) { lines.push(line); line = ""; }
                lines.push(head);
                word = word.slice(i);
            }
            const trial = line ? line + " " + word : word;
            if (line && ctx.measureText(trial).width > maxWidth) {
                lines.push(line);
                line = word;
            } else {
                line = trial;
            }
        }
        lines.push(line);
    }
    return lines.length ? lines : [""];
}

/** Render every caption box onto `ctx`, scaling normalized coords by (w, h). */
export function drawCaption(ctx: CanvasLike, layout: CaptionLayout, w: number, h: number): void {
    for (const box of layout.boxes) {
        if (!box.text) continue;
        const fontPx = Math.max(1, Math.round(box.fontScale * h));
        const isMeme = box.kind === "meme";
        ctx.font = `${isMeme ? "bold " : ""}${fontPx}px ${isMeme ? MEME_FONT : 'sans-serif'}`;
        ctx.textAlign = box.align;
        ctx.textBaseline = "top";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "#000";
        ctx.lineWidth = fontPx * 0.14;
        ctx.fillStyle = box.color;

        const maxWidth = Math.max(1, box.w * w);
        const anchorX = (box.align === "center" ? box.x : box.align === "right" ? box.x + box.w : box.x) * w;
        const lineHeight = fontPx * 1.15;
        const lines = wrapText(ctx, isMeme ? box.text.toUpperCase() : box.text, maxWidth);

        let y = box.y * h;
        for (const line of lines) {
            if (box.outline) ctx.strokeText(line, anchorX, y);
            ctx.fillText(line, anchorX, y);
            y += lineHeight;
        }
    }
}

// ---- Paint-like editor text layer (output-px, drawn CENTERED at the local origin) ----------------
// The compositor sets the layer transform (translate to center / rotate / scale) and then calls
// drawTextLayer, which renders the wrapped text block centred on (0,0). Same code path in the live
// preview and the export, so they can't drift.

export type TextStyle = {
    text: string;
    boxW: number;       // wrap width, output px (the layer's intrinsic width)
    fontPx: number;     // font size, output px (intrinsic; layer scale is applied by the transform)
    font: string;       // family stack, e.g. 'Impact, "Arial Black", sans-serif'
    bold: boolean;
    italic: boolean;
    color: string;
    outline: boolean;
    outlineW: number;   // stroke width as a fraction of fontPx (e.g. 0.14); ignored when outline is false
    align: "left" | "center" | "right";
    highlight?: string; // optional solid colour drawn behind each line
};

export const FONT_STACKS: Record<string, string> = {
    Impact: 'Impact, "Arial Black", "Anton", sans-serif',
    Sans: '"gg sans", "Helvetica Neue", Helvetica, Arial, sans-serif',
    Serif: 'Georgia, "Times New Roman", serif',
    Mono: '"Consolas", "Courier New", monospace',
    Comic: '"Comic Sans MS", "Comic Neue", cursive'
};

const LINE_H = 1.2;

function applyFont(ctx: CanvasLike, s: TextStyle): void {
    ctx.font = `${s.italic ? "italic " : ""}${s.bold ? "bold " : ""}${s.fontPx}px ${s.font}`;
}

/** The wrapped lines and the layer's intrinsic (unscaled) box size. */
export function measureTextLayer(ctx: CanvasLike, s: TextStyle): { w: number; h: number; lines: string[]; } {
    applyFont(ctx, s);
    const lines = wrapText(ctx, s.text || " ", Math.max(1, s.boxW));
    return { w: Math.max(1, s.boxW), h: Math.max(1, lines.length * s.fontPx * LINE_H), lines };
}

/** Draw the text block CENTERED at the local origin (caller owns translate/rotate/scale). */
export function drawTextLayer(ctx: CanvasLike, s: TextStyle): void {
    const { h, lines } = measureTextLayer(ctx, s);
    ctx.textAlign = s.align;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const lh = s.fontPx * LINE_H;
    const anchorX = s.align === "center" ? 0 : s.align === "right" ? s.boxW / 2 : -s.boxW / 2;
    let y = -h / 2 + lh / 2;
    for (const line of lines) {
        if (s.highlight) {
            const lw = ctx.measureText(line).width;
            const x = s.align === "center" ? -lw / 2 : s.align === "right" ? s.boxW / 2 - lw : -s.boxW / 2;
            ctx.fillStyle = s.highlight;
            ctx.fillRect(x - lh * 0.1, y - lh / 2, lw + lh * 0.2, lh);
        }
        if (s.outline && s.outlineW > 0) {
            ctx.strokeStyle = "#000";
            ctx.lineWidth = s.fontPx * s.outlineW;
            ctx.strokeText(line, anchorX, y);
        }
        ctx.fillStyle = s.color;
        ctx.fillText(line, anchorX, y);
        y += lh;
    }
}

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

import { CanvasLike, drawTextLayer, TextStyle } from "./caption";
import { Transform } from "./editorModel";
import { encodeGif } from "./transcode";

// The Paint-like editor's document. Coordinates are OUTPUT-canvas pixels. The media is one layer
// (its intrinsic size is the decoded frame size); text layers sit on top. `bg` fills the exposed
// canvas (the meme "white space").
export interface TextLayer extends TextStyle { id: string; t: Transform; }
export interface EditorModel {
    W: number;
    H: number;
    bg: string;
    media: { t: Transform; };
    texts: TextLayer[];
}

/**
 * Render one media frame + all text layers onto `ctx` (sized to model.W×H). The SAME function drives
 * the live preview (per animation frame) and the export, so what you see is what you send. `fw/fh`
 * are the decoded frame's dimensions (the media layer's intrinsic size).
 */
export function composite(ctx: CanvasRenderingContext2D, frame: CanvasImageSource, fw: number, fh: number, model: EditorModel): void {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, model.W, model.H);
    if (model.bg && model.bg !== "transparent") {
        ctx.fillStyle = model.bg;
        ctx.fillRect(0, 0, model.W, model.H);
    }

    // media layer
    const m = model.media.t;
    ctx.save();
    ctx.translate(m.cx, m.cy);
    ctx.rotate(m.rot);
    ctx.scale(m.scale, m.scale);
    ctx.drawImage(frame, -fw / 2, -fh / 2, fw, fh);
    ctx.restore();

    // text layers, each drawn centred at its own origin
    for (const layer of model.texts) {
        ctx.save();
        ctx.translate(layer.t.cx, layer.t.cy);
        ctx.rotate(layer.t.rot);
        ctx.scale(layer.t.scale, layer.t.scale);
        drawTextLayer(ctx as unknown as CanvasLike, layer);
        ctx.restore();
    }
    ctx.restore();
}

/**
 * Composite every decoded frame through `composite` and re-encode: >1 frame ⇒ animated GIF,
 * a single still ⇒ PNG. `frames` are the canvases from decodeFrames; `delays` their per-frame ms.
 */
export async function exportCaptioned(frames: HTMLCanvasElement[], delays: number[], model: EditorModel): Promise<{ blob: Blob; filename: string; }> {
    if (!frames.length) throw new Error("no frames to export");
    const fw = frames[0].width, fh = frames[0].height;

    if (frames.length === 1) {
        const out = document.createElement("canvas");
        out.width = model.W;
        out.height = model.H;
        const ctx = out.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("could not get 2d context");
        composite(ctx, frames[0], fw, fh, model);
        const blob = await new Promise<Blob>((resolve, reject) =>
            out.toBlob(b => b ? resolve(b) : reject(new Error("toBlob failed")), "image/png"));
        return { blob, filename: "caption.png" };
    }

    const rendered: HTMLCanvasElement[] = [];
    for (const frame of frames) {
        const c = document.createElement("canvas");
        c.width = model.W;
        c.height = model.H;
        const cctx = c.getContext("2d", { willReadFrequently: true });
        if (!cctx) continue;
        composite(cctx, frame, fw, fh, model);
        rendered.push(c);
    }
    return { blob: encodeGif(rendered, delays, model.W, model.H), filename: "caption.gif" };
}

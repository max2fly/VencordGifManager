/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2024 Vendicated and contributors
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

import { EXT_MIME, OUTPUT_CAPS, VIDEO_EXTS } from "../constants";
import { extractVideoFrames } from "./transcode";

const { MAX_DIM, IMAGE_MAX_DIM, MAX_FRAMES } = OUTPUT_CAPS;
const MIN_DELAY_MS = 20;

export type DecodedFrames = { frames: HTMLCanvasElement[]; delays: number[]; w: number; h: number };

/** Decode any supported source into capped, evenly-scaled canvas frames + per-frame delays. */
export async function decodeFrames(blob: Blob, ext: string): Promise<DecodedFrames> {
    const e = ext.toLowerCase();
    if (VIDEO_EXTS.includes(e)) return extractVideoFrames(blob);
    return decodeImageFrames(blob, e);
}

// Images/gifs (static or animated) via WebCodecs ImageDecoder; falls back to a single frame.
async function decodeImageFrames(blob: Blob, ext: string): Promise<DecodedFrames> {
    const type = EXT_MIME[ext] ?? blob.type ?? "image/gif";
    const AnyDecoder = (globalThis as any).ImageDecoder;
    if (AnyDecoder) {
        let dec: any;
        try {
            dec = new AnyDecoder({ data: await blob.arrayBuffer(), type });
            await dec.tracks.ready;
            const track = dec.tracks.selectedTrack;
            // Static images (single frame) keep near-native resolution; animated (gif) stays
            // capped since res × frames drives the re-encoded gif's size + encode time.
            const cap = (track?.frameCount ?? 1) > 1 ? MAX_DIM : IMAGE_MAX_DIM;
            const frames: HTMLCanvasElement[] = [];
            const delays: number[] = [];
            let dims: { w: number; h: number } | null = null;
            for (let i = 0; i < MAX_FRAMES; i++) {
                let result;
                try {
                    result = await dec.decode({ frameIndex: i, completeFramesOnly: true });
                } catch { break; } // RangeError past the last frame
                const frame = result.image; // VideoFrame
                try {
                    if (!dims) dims = scaleDims(frame.displayWidth, frame.displayHeight, cap);
                    const canvas = drawToCanvas(frame, dims.w, dims.h);
                    frames.push(canvas);
                    delays.push(Math.max(MIN_DELAY_MS, Math.round((frame.duration ?? 0) / 1000) || MIN_DELAY_MS));
                } finally {
                    frame.close(); // always release, even if drawToCanvas throws
                }
                const total = track?.frameCount ?? 1;
                if (total && i >= total - 1) break;
            }
            if (frames.length) return { frames, delays, w: dims!.w, h: dims!.h };
        } catch (err) {
            console.error("[GifManager] ImageDecoder failed; falling back to single frame", err);
        } finally {
            dec?.close?.(); // release the decoder on every path (success, break-return, throw)
        }
    }
    // Fallback: one static frame (loses animation) — treat as a static image.
    const bmp = await createImageBitmap(blob);
    const { w, h } = scaleDims(bmp.width, bmp.height, IMAGE_MAX_DIM);
    const canvas = drawToCanvas(bmp, w, h);
    bmp.close();
    return { frames: [canvas], delays: [MIN_DELAY_MS], w, h };
}

function scaleDims(vw: number, vh: number, maxDim: number): { w: number; h: number } {
    const scale = Math.min(1, maxDim / Math.max(vw, vh || 1));
    return { w: Math.max(1, Math.round(vw * scale)), h: Math.max(1, Math.round((vh || vw) * scale)) };
}

function drawToCanvas(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(src, 0, 0, w, h);
    return canvas;
}

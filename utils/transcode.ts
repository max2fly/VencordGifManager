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

import { applyPalette, GIFEncoder, quantize } from "gifenc";

import { OUTPUT_CAPS } from "../constants";
import type { DecodedFrames } from "./frames";

const { MAX_DIM, TARGET_FPS, MAX_FRAMES } = OUTPUT_CAPS;

/** Decode a video blob into evenly-sampled frames (canvas per frame), capped for size/CPU. */
export async function extractVideoFrames(blob: Blob): Promise<DecodedFrames> {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;

    try {
        await new Promise<void>((resolve, reject) => {
            video.onloadeddata = () => resolve();
            video.onerror = () => reject(new Error("video failed to load for transcode"));
        });

        const duration = video.duration;
        if (!isFinite(duration) || duration <= 0) throw new Error("video has no usable duration");

        const scale = Math.min(1, MAX_DIM / Math.max(video.videoWidth, video.videoHeight));
        const w = Math.max(1, Math.round(video.videoWidth * scale));
        const h = Math.max(1, Math.round(video.videoHeight * scale));

        const frameCount = Math.min(MAX_FRAMES, Math.max(1, Math.floor(duration * TARGET_FPS)));
        const delay = Math.round(1000 / TARGET_FPS);

        const frames: HTMLCanvasElement[] = [];
        const delays: number[] = [];
        for (let i = 0; i < frameCount; i++) {
            await seek(video, (i / frameCount) * duration);
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            if (!ctx) throw new Error("could not get 2d context");
            ctx.drawImage(video, 0, 0, w, h);
            frames.push(canvas);
            delays.push(delay);
        }
        return { frames, delays, w, h };
    } finally {
        URL.revokeObjectURL(url);
    }
}

/** Transcode a video blob into an animated GIF blob (used by recovery + quick-convert). */
export async function videoToGif(blob: Blob): Promise<Blob> {
    const { frames, delays, w, h } = await extractVideoFrames(blob);
    return encodeGif(frames, delays, w, h);
}

/** Encode already-rendered canvas frames into a GIF blob. Shared by transcode + caption export. */
export function encodeGif(frames: HTMLCanvasElement[], delays: number[], w: number, h: number): Blob {
    const gif = GIFEncoder();
    for (let i = 0; i < frames.length; i++) {
        const ctx = frames[i].getContext("2d", { willReadFrequently: true });
        if (!ctx) continue;
        const { data } = ctx.getImageData(0, 0, w, h);
        const palette = quantize(data, 256);
        const index = applyPalette(data, palette);
        gif.writeFrame(index, w, h, { palette, delay: delays[i] });
    }
    gif.finish();
    return new Blob([gif.bytes()], { type: "image/gif" });
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const onSeeked = () => { cleanup(); resolve(); };
        const onError = () => { cleanup(); reject(new Error("seek failed")); };
        const cleanup = () => {
            video.removeEventListener("seeked", onSeeked);
            video.removeEventListener("error", onError);
        };
        video.addEventListener("seeked", onSeeked);
        video.addEventListener("error", onError);
        video.currentTime = time;
    });
}

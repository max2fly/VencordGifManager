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

// Caps to keep the output gif a sane size/CPU cost. Reupload is a rare recovery path,
// so favour "renders inline as a gif" over pixel-perfect fidelity.
const MAX_DIM = 400;       // longest side, px
const TARGET_FPS = 15;
const MAX_FRAMES = 150;    // ~10s at 15fps — safety cap for long clips

/**
 * Transcode a video blob (mp4/webm/…) into an animated GIF blob, by decoding frames
 * through a hidden <video> + canvas and encoding them with gifenc. Used only at reupload
 * time so a recovered video-backed gif renders inline (image) instead of as a video player.
 */
export async function videoToGif(blob: Blob): Promise<Blob> {
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

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("could not get 2d context");

        const frames = Math.min(MAX_FRAMES, Math.max(1, Math.floor(duration * TARGET_FPS)));
        const delay = Math.round(1000 / TARGET_FPS); // ms (gifenc converts to centiseconds)
        const gif = GIFEncoder();

        for (let i = 0; i < frames; i++) {
            await seek(video, (i / frames) * duration);
            ctx.drawImage(video, 0, 0, w, h);
            const { data } = ctx.getImageData(0, 0, w, h);
            const palette = quantize(data, 256);
            const index = applyPalette(data, palette);
            gif.writeFrame(index, w, h, { palette, delay });
        }

        gif.finish();
        return new Blob([gif.bytes()], { type: "image/gif" });
    } finally {
        URL.revokeObjectURL(url);
    }
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

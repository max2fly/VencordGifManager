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

// cant change them now eh. My friend uses this plugin. LOVE YOU FREEZER
export const GIF_ITEM_PREFIX = "gc-moment:";
export const GIF_COLLECTION_PREFIX = "gc:";

// Pseudo-category name for the trashcan: cached gifs that are no longer favorited and not
// in any collection. Chosen to be unlikely to collide with a real search/collection name.
export const TRASH_CATEGORY_NAME = "🗑 Trash";

// Sentinel name of the reserved, pinned "Favorite Media" collection: arbitrary images/videos the
// user favorited (Discord natively only favorites gifs). Reuses all collection machinery.
export const MEDIA_FAVORITES_NAME = "📷 Favorite Media";

// Extensions Discord renders as a <video> player (vs inline image). Canonical shared list.
export const VIDEO_EXTS = ["mp4", "webm", "mov", "mkv", "avi", "m4v", "ogg", "wmv", "flv"];

export const EXT_MIME: Record<string, string> = {
    gif: "image/gif", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
    avif: "image/avif", png: "image/png", webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg"
};

// Discord upload pipeline enums (see UploadAttachmentStore.addFiles usage).
export const DRAFT_TYPE_CHANNEL_MESSAGE = 0;
export const CLOUD_UPLOAD_PLATFORM_WEB = 1;

// Transcode/export caps — keep output gifs a sane size/CPU cost.
// MAX_DIM caps ANIMATED output (gif/video→gif) where res × frames drives file size + encode time.
// IMAGE_MAX_DIM is a much looser guard for STATIC images (PNG export): effectively native for
// real images, only trimming absurdly large sources to bound canvas memory / upload size.
export const OUTPUT_CAPS = { MAX_DIM: 400, IMAGE_MAX_DIM: 4096, TARGET_FPS: 15, MAX_FRAMES: 150 };

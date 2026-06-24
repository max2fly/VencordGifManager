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

import type { PluginNative } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { SelectedChannelStore, Toasts, UserStore } from "@webpack/common";

import * as CollectionManager from "../CollectionManager";
import * as GifLibrary from "../GifLibrary";
import { dropObjectUrl } from "../gifCache";
import { GifRecord } from "../types";
import { classifyHost, getGifKey, hashKey } from "./gifKey";
import { nativeRebaseFavorite } from "./nativeFavorites";
import { videoToGif } from "./transcode";

// Discord's upload pipeline. Staging a file via addFiles drops it into the message
// composer as a pending attachment (the user then sends it) — the same interception
// point the chat-encryption plugin uses, and the gifPaste-style "add to your message"
// UX rather than an instant send.
const UploadAttachmentStore = findByPropsLazy("addFiles");
const Native = VencordNative.pluginHelpers.GifManager as PluginNative<typeof import("../native")>;

const DraftType_ChannelMessage = 0;
const CloudUploadPlatform_WEB = 1;

// Uploaded VIDEO attachments render as a video player; image-class render inline like a gif.
const VIDEO_EXTS = ["mp4", "webm", "mov", "mkv", "avi"];
const EXT_MIME: Record<string, string> = {
    gif: "image/gif", mp4: "video/mp4", webm: "video/webm", avif: "image/avif",
    png: "image/png", webp: "image/webp", jpg: "image/jpeg"
};

// Recoveries awaiting their send. Keyed by the gif's (old) library key. We match the eventual
// sent attachment by exact byte size (anonymizer-proof — renaming can't change the size), then
// rebase. The rebase transfers the existing LOCAL original (higher quality than the server's
// possibly-recompressed copy), so we don't need to stash any bytes — only the match size.
interface PendingRecovery {
    oldKey: string;
    oldUrl: string;
    size: number;
    channelId: string;
    ts: number;
}
const pending = new Map<string, PendingRecovery>();
const PENDING_TTL_MS = 10 * 60 * 1000;

function toast(message: string, type: number) {
    Toasts.show({ message, type, id: Toasts.genId(), options: { duration: 3000, position: Toasts.Position.BOTTOM } });
}

function prunePending() {
    const now = Date.now();
    for (const [k, p] of pending) if (now - p.ts > PENDING_TTL_MS) pending.delete(k);
}

/**
 * Recover a gif whose remote source is gone: read the local backup, transcode video → gif
 * (so it renders inline rather than as a video player), stage it into the current channel's
 * composer, and register a pending recovery so we can rebase to the new url once it's sent.
 */
export async function recoverGif(record: GifRecord): Promise<void> {
    if (!record.localExt) return toast("This gif isn't backed up locally — can't recover it", Toasts.Type.FAILURE);

    const channelId = SelectedChannelStore.getChannelId();
    if (!channelId) return;
    if (!UploadAttachmentStore?.addFiles) return toast("Upload module not ready — try again", Toasts.Type.FAILURE);

    const raw = await Native.readGif(hashKey(record.key), record.localExt);
    if (!raw) return toast("Local backup file is missing", Toasts.Type.FAILURE);

    let blob = new Blob([raw], { type: EXT_MIME[record.localExt] ?? "application/octet-stream" });
    let ext = record.localExt;
    let filename = `gif.${ext}`;

    if (VIDEO_EXTS.includes(record.localExt)) {
        try {
            toast("Converting to gif…", Toasts.Type.MESSAGE);
            blob = await videoToGif(blob);
            ext = "gif";
            filename = "gif.gif";
        } catch (e) {
            console.error("[GifManager] transcode failed; staging original video", e);
        }
    }

    const sentSize = blob.size;
    prunePending();
    // Only rebase to the new url when the original CDN source is actually forgotten/gone.
    // A manual "Reupload From Backup" on a healthy gif just sends the backup — no rebase.
    if (record.status === "gone") {
        pending.set(record.key, {
            oldKey: record.key,
            oldUrl: record.url,
            size: sentSize,
            channelId,
            ts: Date.now()
        });
    }

    const file = new File([blob], filename, { type: blob.type });
    UploadAttachmentStore.addFiles({
        channelId,
        draftType: DraftType_ChannelMessage,
        files: [{ file, platform: CloudUploadPlatform_WEB }]
    });
    toast("Recovered from local backup — added to your message", Toasts.Type.SUCCESS);
}

/**
 * Hooked to MESSAGE_CREATE. When one of YOUR messages lands carrying an attachment whose
 * byte size matches a pending recovery (in the same channel), that's our reuploaded gif —
 * capture its fresh url and rebase the gif onto it (cache, collection, native favorite).
 */
export function onMessageCreate(event: any) {
    if (!pending.size) return;
    if (event?.optimistic) return;          // wait for the server-confirmed message (real cdn url)
    const message = event?.message;
    if (!message?.attachments?.length) return;
    if (message.author?.id !== UserStore.getCurrentUser()?.id) return;

    prunePending();
    for (const attachment of message.attachments) {
        const url = attachment?.url;
        // only the finalized cdn/media url — optimistic/temporary urls aren't durable
        if (typeof url !== "string" || !/^https:\/\/(cdn|media)\.discord(app)?\./.test(url)) continue;
        for (const p of pending.values()) {
            if (p.channelId === message.channel_id && attachment.size === p.size) {
                pending.delete(p.oldKey);
                void rebase(p, url, attachment.width, attachment.height);
                break;
            }
        }
    }
}

async function rebase(p: PendingRecovery, newUrl: string, width?: number, height?: number) {
    try {
        const newKey = getGifKey(newUrl);
        const old = GifLibrary.getRecord(p.oldKey);
        if (!old?.localExt) return;   // nothing to transfer
        const ext = old.localExt;     // keep the ORIGINAL local file (better quality than the server copy)

        // 1. Transfer the existing local cache to the new key — by MOVE (no rewrite). The local
        //    original always wins (identical for images; higher quality than the recompressed
        //    server gif for transcoded videos). Fall back to read→write→delete if rename fails.
        if (newKey !== p.oldKey) {
            const moved = await Native.renameGif(hashKey(p.oldKey), ext, hashKey(newKey), ext);
            if (!moved) {
                const bytes = await Native.readGif(hashKey(p.oldKey), ext);
                if (!bytes) { console.error("[GifManager] rebase: local file gone; aborting"); return; }
                await Native.saveGif(hashKey(newKey), bytes, ext);
                await Native.deleteGif(hashKey(p.oldKey), ext).catch(() => {});
            }
        }
        // verify the file is now at the new key before committing the record
        if (!(await Native.readGif(hashKey(newKey), ext))) {
            console.error("[GifManager] rebase: cache transfer failed to land; aborting");
            return;
        }

        // 2. Move the library record onto the new url (healthy again). Keep the ORIGINAL format/ext
        //    so the picker renders the local original; the url points at the new attachment for sends.
        await GifLibrary.rebaseRecord(p.oldKey, {
            key: newKey,
            url: newUrl,
            src: getGifKey(newUrl),
            host: classifyHost(newUrl),
            width: width ?? old.width,
            height: height ?? old.height,
            format: old.format,
            localExt: ext,
            status: "ok",
            lastCheckedAt: Date.now()
        });

        // 3. Update any collection holding it, in place (keeps its position).
        await CollectionManager.replaceGifUrl(p.oldUrl, newUrl);
        dropObjectUrl(p.oldKey);

        // 4. Atomically swap the native favorite (one proto update — no "kept both" race).
        nativeRebaseFavorite(p.oldUrl, { id: "", url: newUrl, src: newUrl, width: old.width, height: old.height });

        toast("Gif rebased to the new working url", Toasts.Type.SUCCESS);
    } catch (e) {
        console.error("[GifManager] rebase failed", e);
    }
}

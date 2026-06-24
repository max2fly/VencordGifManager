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

import { app } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "fs/promises";
import { join } from "path";

function gifsDir(): string {
    return join(app.getPath("userData"), "VencordGifManager", "gifs");
}

function safeName(fileId: string, ext: string): string {
    // fileId is a hex hash; ext is an alphanumeric extension. Reject anything else.
    if (!/^[0-9a-f]+$/i.test(fileId) || !/^[a-z0-9]+$/i.test(ext))
        throw new Error("invalid gif file id/ext");
    return `${fileId}.${ext}`;
}

export async function saveGif(_: IpcMainInvokeEvent, fileId: string, bytes: Uint8Array, ext: string): Promise<string> {
    const dir = gifsDir();
    await mkdir(dir, { recursive: true });
    const path = join(dir, safeName(fileId, ext));
    await writeFile(path, bytes);
    return path;
}

export async function readGif(_: IpcMainInvokeEvent, fileId: string, ext: string): Promise<Uint8Array | null> {
    try {
        const buf = await readFile(join(gifsDir(), safeName(fileId, ext)));
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } catch {
        return null;
    }
}

export async function deleteGif(_: IpcMainInvokeEvent, fileId: string, ext: string): Promise<void> {
    await rm(join(gifsDir(), safeName(fileId, ext))).catch(() => { });
}

// Move a cached file from one id/ext to another (used by rebase to transfer the cache to the
// new url's key WITHOUT rewriting bytes). Returns false if the source isn't there.
export async function renameGif(_: IpcMainInvokeEvent, oldId: string, oldExt: string, newId: string, newExt: string): Promise<boolean> {
    try {
        await mkdir(gifsDir(), { recursive: true });
        await rename(join(gifsDir(), safeName(oldId, oldExt)), join(gifsDir(), safeName(newId, newExt)));
        return true;
    } catch {
        return false;
    }
}

export async function listCached(_: IpcMainInvokeEvent): Promise<string[]> {
    try {
        return await readdir(gifsDir());
    } catch {
        return [];
    }
}

export async function fetchUrl(_: IpcMainInvokeEvent, url: string): Promise<{ status: number; mime: string; bytes: Uint8Array | null; bodyText: string | null; }> {
    try {
        // Always bound the request — a hung fetch would otherwise occupy a download-queue
        // slot forever and eventually starve all caching.
        const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
        const mime = res.headers.get("content-type")?.split(";")[0].trim() ?? "";
        if (!res.ok) {
            // small body only — enough to detect NoSuchKey
            const bodyText = await res.text().catch(() => "");
            return { status: res.status, mime, bytes: null, bodyText: bodyText.slice(0, 512) };
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        return { status: res.status, mime, bytes: buf, bodyText: null };
    } catch {
        return { status: -1, mime: "", bytes: null, bodyText: null };
    }
}

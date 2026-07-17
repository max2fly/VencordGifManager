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

export type FetchOutcome = { status: number; bodyText?: string };
export type GifHost = "tenor" | "cdn" | "other";

/**
 * Availability verdict for a media url, from native.ts:fetchUrl's result. `fetchUrl` returns the
 * real HTTP status on any server response and `status <= 0` only on a true network error/timeout
 * (its catch). The verdict is HOST-AWARE, because a raw fetch means different things per host:
 *
 *   - status <= 0 → "transient": no response reached us — likely OUR connectivity, not the source.
 *   - 2xx/3xx (redirects auto-followed) → "ok": the source served the media.
 *   - a real HTTP error (4xx/5xx):
 *       • Discord CDN (`cdn`): NOT trustworthy on its own. Discord restricts direct CDN access to
 *         the client's own send path and RE-SIGNS the attachment on every send, so a raw probe's
 *         403/5xx usually just means our probe signature is stale — the attachment still sends
 *         fine. Trust ONLY the definitive deleted-object signal (404 + `NoSuchKey`, which requires
 *         probing a validly-signed url); treat any other error as "transient" (send the link).
 *       • tenor / other: a direct fetch is exactly what recipients get (no re-signing), so any
 *         HTTP error means the link is dead for everyone → "unavailable".
 */
export function classifyFetchResult({ status, bodyText }: FetchOutcome, host: GifHost): "ok" | "unavailable" | "transient" {
    if (status <= 0) return "transient";
    if (status < 400) return "ok";
    if (host === "cdn") return status === 404 && bodyText?.includes("NoSuchKey") ? "unavailable" : "transient";
    return "unavailable";
}

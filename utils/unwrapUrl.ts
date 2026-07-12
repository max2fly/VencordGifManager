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

// Media urls frequently arrive WRAPPED, with the real file hidden one or more layers down:
//   - Discord's image proxy: images-ext-1.discordapp.net/external/<sig>/[<encoded ?query>/]<scheme>/<host>/<path>
//   - converter/redirect services that carry the source in a query param: …/convert.avif?url=<source>
// Such a url carries no usable extension of its own, so classification has to peel it first.

const URL_PARAMS = ["url", "src", "u", "image", "media"];
const MAX_HOPS = 3;

/** The url this one wraps, or undefined when it isn't a wrapper. */
export function unwrapUrl(url: string): string | undefined {
    let u: URL;
    try {
        u = new URL(url.startsWith("http") ? url : "https:" + url);
    } catch {
        return undefined;
    }

    for (const key of URL_PARAMS) {
        const value = u.searchParams.get(key);
        if (value && /^https?:\/\//i.test(value)) return value;
    }

    if (u.hostname.endsWith(".discordapp.net") && u.pathname.startsWith("/external/")) {
        // /external/<signature>/[<encoded ?query>/]<scheme>/<host>/<path…>
        const rest = u.pathname.split("/").filter(Boolean).slice(2);
        let query = "";
        try {
            if (rest[0]?.startsWith("%3F")) query = decodeURIComponent(rest.shift()!);
            const scheme = rest.shift();
            if ((scheme === "https" || scheme === "http") && rest.length)
                return `${scheme}://${rest.map(decodeURIComponent).join("/")}${query}`;
        } catch {
            return undefined; // malformed percent-encoding
        }
    }

    return undefined;
}

/** Every url worth inspecting, outermost first: [url, what it wraps, …]. */
export function unwrapChain(url: string): string[] {
    const chain = [url];
    for (let i = 0; i < MAX_HOPS; i++) {
        const next = unwrapUrl(chain[chain.length - 1]);
        if (!next || chain.includes(next)) break;
        chain.push(next);
    }
    return chain;
}

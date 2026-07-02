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

export enum Format { NONE = 0, IMAGE = 1, VIDEO = 2 }

export interface Category {
    type: "Trending" | "Category";
    name: string;
    src: string;
    format: Format;
    order?: number;        // explicit tile order (regular collections only); assigned by migration
    gifs?: Gif[];
}

export interface Gif {
    id: string,
    src: string;
    url: string;
    height: number,
    width: number;
    key?: string;
}

export interface Props {
    favorites: any[] | { [src: string]: any; };
    trendingCategories: Category[];
    query?: string;
    resultItems?: any[];
}

type WithRequired<T, K extends keyof T> = T & { [P in K]-?: T[P] };

export type Collection = WithRequired<Category, "gifs">;

export type Host = "tenor" | "cdn" | "other";
export type GifStatus = "ok" | "gone";

export interface GifRecord {
    key: string;            // getGifKey(url) — stable identity
    url: string;            // original bare url
    src: string;            // media src (bare)
    host: Host;
    width: number;
    height: number;
    format: Format;
    localExt: string | null;   // file extension on disk; null until cached
    status: GifStatus;         // "gone" = confirmed 404 NoSuchKey
    lastCheckedAt: number;     // epoch ms; 0 = never checked
    reuploadedUrl?: string;    // freshest working url after a reupload
}

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

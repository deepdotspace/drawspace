/**
 * Folder Feature - Schema
 *
 * Folders are a per-user organizational layer over boards: a board can sit in
 * one folder (via `canvases.folderId`) or be "unfiled". Folders are PRIVATE to
 * their owner — they don't gate board access (that's the board's own
 * `collaborators`), they just organize the owner's own sidebar. A board shared
 * with you shows up unfiled in your sidebar; the owner's folders aren't yours.
 */

import type { CollectionSchema } from 'deepspace/worker'

export const folderSchema: CollectionSchema = {
  name: 'folders',
  columns: [
    { name: 'name', storage: 'text', interpretation: 'plain', required: true },
    { name: 'ownerId', storage: 'text', interpretation: 'plain', required: true, userBound: true, immutable: true },
  ],
  ownerField: 'ownerId',
  permissions: {
    // Private to the owner — only you see/manage your folders.
    viewer: { read: 'own', create: false, update: false, delete: false },
    member: { read: 'own', create: true, update: 'own', delete: 'own' },
    admin: { read: true, create: true, update: true, delete: true },
  },
}

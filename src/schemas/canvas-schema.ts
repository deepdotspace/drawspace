/**
 * Canvas Feature - Schema
 *
 * A canvas document collection for listing/managing canvas documents.
 * The actual shape data lives in the CanvasRoom DO (Yjs-backed),
 * not in RecordRoom. This schema is just for document metadata.
 */

import type { CollectionSchema } from 'deepspace/worker'

export const canvasSchema: CollectionSchema = {
  name: 'canvases',
  columns: [
    { name: 'title', storage: 'text', interpretation: 'plain', required: true },
    { name: 'ownerId', storage: 'text', interpretation: 'plain', required: true, userBound: true, immutable: true },
    // User IDs invited to view + edit this board. Managed from the Manage
    // dialog. This gates BOTH the record's visibility (collaboratorsField,
    // below) and the realtime CanvasRoom connection (resolveCanvasRole in
    // worker.ts) — keep the two in sync.
    { name: 'collaborators', storage: 'text', interpretation: { kind: 'json' } },
    // Organizational folder this board sits in (a `folders` recordId), or
    // empty/unset for "unfiled". Per-user organization only — it does NOT gate
    // access (that's `collaborators`). See src/schemas/folder-schema.ts.
    { name: 'folderId', storage: 'text', interpretation: 'plain' },
    // Soft-delete marker. Empty/unset = live; an ISO timestamp = "in Trash".
    // Boards aren't hard-deleted on the spot: the owner can restore from Trash,
    // and a daily cron (`purge-trash`) hard-deletes the record AND wipes the
    // CanvasRoom DO storage once it's older than the retention window. See
    // src/canvas-purge.ts + worker.ts.
    { name: 'deletedAt', storage: 'text', interpretation: 'plain' },
  ],
  ownerField: 'ownerId',
  collaboratorsField: 'collaborators',
  permissions: {
    // Boards are PRIVATE: only the owner or an invited collaborator can list
    // or open one. `'collaborator'` = owner OR present in `collaborators`.
    // Only the owner (or an admin) renames, re-shares, or deletes a board.
    viewer: { read: 'collaborator', create: false, update: false, delete: false },
    member: { read: 'collaborator', create: true, update: 'own', delete: 'own' },
    admin: { read: true, create: true, update: true, delete: true },
  },
}

/**
 * Collection Schemas
 *
 * All collections with columns and RBAC permissions.
 * Single source of truth — imported by both worker and frontend.
 *
 * Add schemas by creating a file in src/schemas/ and importing it here.
 */

import type { CollectionSchema } from 'deepspace/worker'
import { usersSchema } from './schemas/users-schema'
import { settingsSchema } from './schemas/admin-schema'

import { canvasSchema } from './schemas/canvas-schema'
import { folderSchema } from './schemas/folder-schema'

import { aiChatSchemas } from './schemas/ai-chat-schema'

export const schemas: CollectionSchema[] = [
  ...aiChatSchemas,
  canvasSchema,
  folderSchema,
  usersSchema,
  settingsSchema,
]

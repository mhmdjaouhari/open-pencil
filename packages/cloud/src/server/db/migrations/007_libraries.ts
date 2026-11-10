import type { Kysely } from 'kysely'

import { dropTables, now, required } from './schema'

/** A workspace's component libraries: each file the library catalog writes, by its path. */
const TABLES = ['workspace_library_object']

export async function up(database: Kysely<unknown>): Promise<void> {
  // The file stored at a library path; writing the path again points it at a new stored file and
  // leaves the old one to the object sweep.
  await database.schema
    .createTable('workspace_library_object')
    .addColumn('workspace_id', 'uuid', (column) =>
      column.notNull().references('workspace.id').onDelete('cascade')
    )
    .addColumn('path', 'text', required)
    .addColumn('storage_object_id', 'uuid', (column) =>
      column.notNull().unique().references('storage_object.id')
    )
    .addColumn('updated_by', 'text', required)
    .addColumn('updated_at', 'timestamptz', now)
    .addPrimaryKeyConstraint('workspace_library_object_pkey', ['workspace_id', 'path'])
    .execute()
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await dropTables(database, TABLES)
}

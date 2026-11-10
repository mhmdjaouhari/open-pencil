import type {
  CommitLibraryObjectInput,
  CommittedLibraryObject,
  CreateLibraryUploadInput,
  LibraryObject,
  LibraryObjectSummary,
  LibraryUpload
} from '#cloud/contract'
import { workspaceRoleCan, type AccessRequest } from '#cloud/server/auth/access-control'
import type { CloudDatabase } from '#cloud/server/db'
import type { ObjectStore } from '#cloud/server/objects'
import { findWorkspace } from '#cloud/server/workspaces/repository'
import type { Kysely } from 'kysely'

const DOWNLOAD_LIFETIME_MS = 5 * 60 * 1000
/**
 * How long a publisher has to put a file and commit it. Shorter than the object sweep's grace
 * (`OBJECT_SWEEP_GRACE_MS`), so a file recorded for an upload is never swept before it can land.
 */
export const LIBRARY_UPLOAD_LIFETIME_MS = 10 * 60 * 1000

/** The workspace does not exist, or the person is not in it. */
export class LibraryNotFoundError extends Error {
  override readonly name = 'LibraryNotFoundError'
}
/** The person is in the workspace but may not publish its libraries. */
export class LibraryForbiddenError extends Error {
  override readonly name = 'LibraryForbiddenError'
}
/** A write's precondition failed: the path moved on from the version it named, or exists. */
export class LibraryConflictError extends Error {
  override readonly name = 'LibraryConflictError'
}
/** An upload is not the file it declared, or no longer one that can land. */
export class LibraryUploadInvalidError extends Error {
  override readonly name = 'LibraryUploadInvalidError'
}

export type LibraryServiceOptions = {
  /** The largest file the deployment accepts, which a library file may not pass either. */
  technicalMaximumUploadBytes?: number
}

/** Where an upload's bytes go: under the workspace, named by the file's own id. */
const uploadKey = (workspaceId: string, storageObjectId: string) =>
  `libraries/${workspaceId}/${storageObjectId}.json`

/**
 * A workspace's component libraries, as the files the editor's library catalog reads and writes
 * (`open-pencil/libraries/…`). Bytes go to and from the object store through presigned links, as
 * documents' do; a path points at its current file, whose id is its version.
 */
export function createLibraryService(
  database: Kysely<CloudDatabase>,
  objects: ObjectStore,
  options: LibraryServiceOptions = {}
) {
  async function requireAccess(userId: string, workspaceId: string, request: AccessRequest) {
    const workspace = await findWorkspace(database, userId, workspaceId)
    if (!workspace) throw new LibraryNotFoundError()
    if (!workspaceRoleCan(workspace.role, request)) throw new LibraryForbiddenError()
  }

  function filesOf(workspaceId: string) {
    return database
      .selectFrom('workspaceLibraryObject')
      .innerJoin('storageObject', 'storageObject.id', 'workspaceLibraryObject.storageObjectId')
      .where('workspaceLibraryObject.workspaceId', '=', workspaceId)
  }

  return {
    async list(
      userId: string,
      workspaceId: string,
      prefix: string
    ): Promise<LibraryObjectSummary[]> {
      await requireAccess(userId, workspaceId, { library: ['read'] })
      const rows = await filesOf(workspaceId)
        .select([
          'workspaceLibraryObject.path',
          'workspaceLibraryObject.storageObjectId',
          'storageObject.byteSize'
        ])
        // A plain prefix test: paths hold `_`, which `LIKE` would read as a wildcard.
        .where((expression) =>
          expression.fn<boolean>('starts_with', [
            expression.ref('workspaceLibraryObject.path'),
            expression.val(prefix)
          ])
        )
        .orderBy('workspaceLibraryObject.path')
        .execute()
      return rows.map((row) => ({
        path: row.path,
        byteSize: Number(row.byteSize),
        etag: row.storageObjectId
      }))
    },

    async get(userId: string, workspaceId: string, path: string): Promise<LibraryObject | null> {
      await requireAccess(userId, workspaceId, { library: ['read'] })
      const row = await filesOf(workspaceId)
        .select([
          'workspaceLibraryObject.storageObjectId',
          'storageObject.objectKey',
          'storageObject.byteSize',
          'storageObject.checksum',
          'storageObject.contentType'
        ])
        .where('workspaceLibraryObject.path', '=', path)
        .executeTakeFirst()
      if (!row) return null
      return {
        path,
        byteSize: Number(row.byteSize),
        checksum: row.checksum,
        contentType: row.contentType,
        etag: row.storageObjectId,
        download: await objects.createDownload({
          key: row.objectKey,
          expiresAt: new Date(Date.now() + DOWNLOAD_LIFETIME_MS)
        })
      }
    },

    /**
     * Where to put a file a publisher is about to write. The file is recorded before it is
     * written and referenced only once it lands (`commit`), so one that never lands is a file
     * nothing refers to, which the object sweep removes.
     */
    async createUpload(
      userId: string,
      workspaceId: string,
      input: CreateLibraryUploadInput
    ): Promise<LibraryUpload> {
      await requireAccess(userId, workspaceId, { library: ['publish'] })
      const maximum = options.technicalMaximumUploadBytes
      if (maximum !== undefined && input.byteSize > maximum) throw new LibraryUploadInvalidError()
      const storageObjectId = crypto.randomUUID()
      const objectKey = uploadKey(workspaceId, storageObjectId)
      await database
        .insertInto('storageObject')
        .values({
          id: storageObjectId,
          objectKey,
          checksum: input.checksum,
          byteSize: input.byteSize,
          contentType: input.contentType
        })
        .execute()
      const upload = await objects.createUpload({
        key: objectKey,
        byteSize: input.byteSize,
        checksum: input.checksum,
        contentType: input.contentType,
        expiresAt: new Date(Date.now() + LIBRARY_UPLOAD_LIFETIME_MS)
      })
      return { uploadId: storageObjectId, upload }
    },

    /**
     * Makes an upload the file at its path, once the store holds the bytes it declared and the
     * path is still at the version the write names. Committing the same upload again answers as
     * the first commit did.
     */
    async commit(
      userId: string,
      workspaceId: string,
      input: CommitLibraryObjectInput
    ): Promise<CommittedLibraryObject> {
      await requireAccess(userId, workspaceId, { library: ['publish'] })
      const objectKey = uploadKey(workspaceId, input.uploadId)
      const recorded = await database
        .selectFrom('storageObject')
        .select(['checksum', 'byteSize', 'contentType', 'createdAt'])
        .where('id', '=', input.uploadId)
        .where('objectKey', '=', objectKey)
        .executeTakeFirst()
      if (!recorded || recorded.checksum !== input.checksum) throw new LibraryUploadInvalidError()
      const landed = await database
        .selectFrom('workspaceLibraryObject')
        .select(['workspaceId', 'path'])
        .where('storageObjectId', '=', input.uploadId)
        .executeTakeFirst()
      if (landed) {
        if (landed.workspaceId === workspaceId && landed.path === input.path)
          return { etag: input.uploadId }
        throw new LibraryUploadInvalidError()
      }
      const age = Date.now() - new Date(recorded.createdAt).getTime()
      if (age > LIBRARY_UPLOAD_LIFETIME_MS) throw new LibraryUploadInvalidError()
      if (input.multipart) {
        if (!objects.capabilities.multipartUpload) throw new LibraryUploadInvalidError()
        await objects.completeUpload({
          key: objectKey,
          uploadId: input.multipart.uploadId,
          parts: input.multipart.parts
        })
      }
      const stored = await objects.head(objectKey)
      if (
        !stored ||
        stored.checksum !== recorded.checksum ||
        stored.byteSize !== Number(recorded.byteSize) ||
        stored.contentType !== recorded.contentType
      )
        throw new LibraryUploadInvalidError()
      await database.transaction().execute(async (transaction) => {
        const current = await transaction
          .selectFrom('workspaceLibraryObject')
          .select('storageObjectId')
          .where('workspaceId', '=', workspaceId)
          .where('path', '=', input.path)
          .forUpdate()
          .executeTakeFirst()
        if (input.ifNoneMatch && current) throw new LibraryConflictError()
        if (input.ifMatch && current?.storageObjectId !== input.ifMatch)
          throw new LibraryConflictError()
        const written = await transaction
          .insertInto('workspaceLibraryObject')
          .values({
            workspaceId,
            path: input.path,
            storageObjectId: input.uploadId,
            updatedBy: userId,
            updatedAt: new Date()
          })
          .onConflict((conflict) =>
            // A path another write created since the lock above was taken fails `ifNoneMatch`.
            input.ifNoneMatch
              ? conflict.columns(['workspaceId', 'path']).doNothing()
              : conflict.columns(['workspaceId', 'path']).doUpdateSet({
                  storageObjectId: input.uploadId,
                  updatedBy: userId,
                  updatedAt: new Date()
                })
          )
          .returning('path')
          .executeTakeFirst()
        if (!written) throw new LibraryConflictError()
      })
      return { etag: input.uploadId }
    }
  }
}

export type LibraryService = ReturnType<typeof createLibraryService>

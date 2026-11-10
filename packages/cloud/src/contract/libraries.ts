import * as v from 'valibot'

import {
  CLOUD_PROTOCOL_MAX_UPLOAD_BYTES,
  checksumSchema,
  commitUploadSchema,
  objectDownloadSchema,
  objectUploadSchema
} from './documents'

/**
 * Where a workspace's component libraries live: the paths the editor's library catalog reads and
 * writes (`open-pencil/libraries/<library>/manifest.json` and its revisions). A workspace stores
 * nothing else this way, so the routes are no general file store.
 */
export const CLOUD_LIBRARY_PATH_PREFIX = 'open-pencil/libraries/'

/** The one kind of file a library is made of: its manifest and its revisions are JSON. */
export const CLOUD_LIBRARY_CONTENT_TYPE = 'application/json'

const LIBRARY_PATH_PATTERN = /^[A-Za-z0-9._:/-]+$/

/** A path under the library prefix in the characters asset keys allow, without empty or dot segments. */
const libraryPath = (allowTrailingSlash: boolean) =>
  v.pipe(
    v.string(),
    v.maxLength(512),
    v.startsWith(CLOUD_LIBRARY_PATH_PREFIX),
    v.regex(LIBRARY_PATH_PATTERN),
    v.check((path) => {
      const segments = path.split('/')
      if (allowTrailingSlash && segments.at(-1) === '') segments.pop()
      return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
    })
  )

export const libraryObjectPathSchema = libraryPath(false)
export const libraryObjectPrefixSchema = libraryPath(true)

/** A write's version: a new one each time the path is written, which `ifMatch` names. */
const libraryEtagSchema = v.pipe(v.string(), v.uuid())

export const libraryObjectSummarySchema = v.object({
  path: libraryObjectPathSchema,
  byteSize: v.number(),
  etag: libraryEtagSchema
})
export type LibraryObjectSummary = v.InferOutput<typeof libraryObjectSummarySchema>

export const libraryObjectListSchema = v.object({ objects: v.array(libraryObjectSummarySchema) })
export type LibraryObjectList = v.InferOutput<typeof libraryObjectListSchema>

/** A library file and a short-lived link to its bytes in the object store. */
export const libraryObjectSchema = v.object({
  path: libraryObjectPathSchema,
  byteSize: v.number(),
  checksum: checksumSchema,
  contentType: v.string(),
  etag: libraryEtagSchema,
  download: objectDownloadSchema
})
export type LibraryObject = v.InferOutput<typeof libraryObjectSchema>

export const libraryObjectListQuerySchema = v.object({ prefix: libraryObjectPrefixSchema })
export type LibraryObjectListQuery = v.InferOutput<typeof libraryObjectListQuerySchema>

export const libraryObjectQuerySchema = v.object({ path: libraryObjectPathSchema })
export type LibraryObjectQuery = v.InferOutput<typeof libraryObjectQuerySchema>

/** The bytes a publisher is about to write, which the server checks on commit. */
export const createLibraryUploadSchema = v.object({
  byteSize: v.pipe(
    v.number(),
    v.integer(),
    v.minValue(1),
    v.maxValue(CLOUD_PROTOCOL_MAX_UPLOAD_BYTES)
  ),
  checksum: checksumSchema,
  contentType: v.literal(CLOUD_LIBRARY_CONTENT_TYPE)
})
export type CreateLibraryUploadInput = v.InferOutput<typeof createLibraryUploadSchema>

export const libraryUploadSchema = v.object({
  uploadId: v.pipe(v.string(), v.uuid()),
  upload: objectUploadSchema
})
export type LibraryUpload = v.InferOutput<typeof libraryUploadSchema>

/**
 * Makes an upload the file at `path`. `ifMatch` writes only over the version it names and
 * `ifNoneMatch: '*'` only where there is none, as HTTP's preconditions do, so two publishers
 * never overwrite each other's manifest.
 */
export const commitLibraryObjectSchema = v.pipe(
  v.object({
    uploadId: v.pipe(v.string(), v.uuid()),
    path: libraryObjectPathSchema,
    checksum: checksumSchema,
    multipart: commitUploadSchema.entries.multipart,
    ifMatch: v.optional(libraryEtagSchema),
    ifNoneMatch: v.optional(v.literal('*'))
  }),
  v.check((input) => !(input.ifMatch && input.ifNoneMatch), 'Name one precondition at most')
)
export type CommitLibraryObjectInput = v.InferOutput<typeof commitLibraryObjectSchema>

export const committedLibraryObjectSchema = v.object({ etag: libraryEtagSchema })
export type CommittedLibraryObject = v.InferOutput<typeof committedLibraryObjectSchema>

export function parseLibraryObjectListQuery(input: unknown): LibraryObjectListQuery {
  return v.parse(libraryObjectListQuerySchema, input)
}

export function parseLibraryObjectQuery(input: unknown): LibraryObjectQuery {
  return v.parse(libraryObjectQuerySchema, input)
}

export function parseCreateLibraryUpload(input: unknown): CreateLibraryUploadInput {
  return v.parse(createLibraryUploadSchema, input)
}

export function parseCommitLibraryObject(input: unknown): CommitLibraryObjectInput {
  return v.parse(commitLibraryObjectSchema, input)
}

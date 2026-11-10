import {
  committedLibraryObjectSchema,
  libraryObjectListSchema,
  libraryObjectSchema,
  libraryUploadSchema,
  type CommitLibraryObjectInput,
  type CommittedLibraryObject,
  type CreateLibraryUploadInput,
  type LibraryObject,
  type LibraryObjectSummary,
  type LibraryUpload
} from '#cloud/contract'
import type { CloudAPI } from '#cloud/server/api'
import type { hc } from 'hono/client'
import * as v from 'valibot'

import { parseResponse, responseBody, type CloudClientDiagnostic } from './response'

const libraryObjectResponseSchema = v.object({ object: libraryObjectSchema })

/**
 * A workspace's component library files, as the editor's library catalog reads and writes them;
 * their bytes travel through the presigned links these answer with.
 */
export function createLibraryRequests(
  client: ReturnType<typeof hc<CloudAPI>>,
  onDiagnostic?: CloudClientDiagnostic
) {
  const objects = client.workspaces[':workspaceId']['library-objects']
  return {
    async listLibraryObjects(workspaceId: string, prefix: string): Promise<LibraryObjectSummary[]> {
      const response = await parseResponse(
        objects.$get({ param: { workspaceId }, query: { prefix } }),
        libraryObjectListSchema,
        onDiagnostic
      )
      return response.objects
    },
    /** The file at a library path and a link to its bytes, or null when there is none. */
    async getLibraryObject(workspaceId: string, path: string): Promise<LibraryObject | null> {
      const response = await objects.object.$get({ param: { workspaceId }, query: { path } })
      if (response.status === 404) return null
      return v.parse(libraryObjectResponseSchema, await responseBody(response, onDiagnostic)).object
    },
    async createLibraryUpload(
      workspaceId: string,
      input: CreateLibraryUploadInput
    ): Promise<LibraryUpload> {
      return parseResponse(
        objects.uploads.$post({ param: { workspaceId }, json: input }),
        libraryUploadSchema,
        onDiagnostic
      )
    },
    async commitLibraryObject(
      workspaceId: string,
      input: CommitLibraryObjectInput
    ): Promise<CommittedLibraryObject> {
      return parseResponse(
        objects.commits.$post({ param: { workspaceId }, json: input }),
        committedLibraryObjectSchema,
        onDiagnostic
      )
    }
  }
}

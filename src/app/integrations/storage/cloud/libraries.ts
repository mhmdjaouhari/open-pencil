import { CloudAPIError, type CloudAPIClient } from '@open-pencil/cloud/client'
import { CLOUD_LIBRARY_CONTENT_TYPE } from '@open-pencil/cloud/contract'

import type { LibraryObjectStore } from '../types'
import { cloudChecksum, fetchVerified } from './download'
import { putCloudObject } from './upload'

type ObjectFetch = (input: string, init: RequestInit) => Promise<Response>

/** The words the library catalog and the S3 store say a lost publication race with. */
const CONFLICT = 'Library revision conflict: latest revision has changed'

/**
 * A Cloud workspace's component libraries as the library catalog's object store: the server
 * keeps each library file's path and version, and the bytes go to and from its object store
 * through the links it gives, as a document's do.
 */
export function cloudLibraryObjects(
  client: () => Promise<CloudAPIClient>,
  workspaceId: () => string,
  objectFetch: ObjectFetch
): LibraryObjectStore {
  async function getObjectValue(key: string) {
    const object = await (await client()).getLibraryObject(workspaceId(), key)
    if (!object) return { bytes: null, etag: null }
    return { bytes: await fetchVerified(object.download, object, objectFetch), etag: object.etag }
  }

  return {
    async getObject(key) {
      return (await getObjectValue(key)).bytes
    },
    getObjectValue,
    async putObject(key, bytes, contentType, options) {
      if (contentType !== CLOUD_LIBRARY_CONTENT_TYPE) {
        throw new Error(`Cloud libraries hold ${CLOUD_LIBRARY_CONTENT_TYPE} files only`)
      }
      const cloud = await client()
      const checksum = await cloudChecksum(bytes)
      const { uploadId, upload } = await cloud.createLibraryUpload(workspaceId(), {
        byteSize: bytes.byteLength,
        checksum,
        contentType
      })
      const multipart = await putCloudObject(upload, { bytes, objectFetch })
      try {
        await cloud.commitLibraryObject(workspaceId(), {
          uploadId,
          path: key,
          checksum,
          multipart,
          ifMatch: options?.ifMatch,
          ifNoneMatch: options?.ifNoneMatch
        })
      } catch (error) {
        if (error instanceof CloudAPIError && error.code === 'precondition_failed') {
          throw new Error(CONFLICT)
        }
        throw error
      }
    },
    async listObjects(prefix) {
      const objects = await (await client()).listLibraryObjects(workspaceId(), prefix)
      return objects.map((object) => ({
        key: object.path,
        size: object.byteSize,
        etag: object.etag
      }))
    }
  }
}

import {
  parseCommitLibraryObject,
  parseCreateLibraryUpload,
  parseLibraryObjectListQuery,
  parseLibraryObjectQuery
} from '#cloud/contract'
import type { CloudActor } from '#cloud/server/auth'
import { validatedJSON, validatedQuery, workspaceParams } from '#cloud/server/validation'
import { Hono, type Context } from 'hono'

import {
  LibraryConflictError,
  LibraryForbiddenError,
  LibraryNotFoundError,
  LibraryUploadInvalidError,
  type LibraryService
} from './service'

export type LibraryRouteEnvironment = {
  Variables: {
    actor: CloudActor
  }
}

/** Runs a library action, answering its domain errors with their HTTP codes. */
async function libraryRoute<T>(context: Context, action: () => Promise<T>): Promise<T | Response> {
  try {
    return await action()
  } catch (error) {
    if (error instanceof LibraryNotFoundError) {
      return context.json({ error: { code: 'not_found' as const } }, 404)
    }
    if (error instanceof LibraryForbiddenError) {
      return context.json({ error: { code: 'forbidden' as const } }, 403)
    }
    if (error instanceof LibraryConflictError) {
      return context.json({ error: { code: 'precondition_failed' as const } }, 412)
    }
    if (error instanceof LibraryUploadInvalidError) {
      return context.json({ error: { code: 'invalid_upload' as const } }, 422)
    }
    throw error
  }
}

/** A workspace's component library files, under `/workspaces/:workspaceId/library-objects`. */
export function createLibraryRoutes(service: LibraryService) {
  return new Hono<LibraryRouteEnvironment>()
    .get(
      '/:workspaceId/library-objects',
      workspaceParams,
      validatedQuery(parseLibraryObjectListQuery),
      (context) =>
        libraryRoute(context, async () =>
          context.json({
            objects: await service.list(
              context.get('actor').userId,
              context.req.valid('param').workspaceId,
              context.req.valid('query').prefix
            )
          })
        )
    )
    .get(
      '/:workspaceId/library-objects/object',
      workspaceParams,
      validatedQuery(parseLibraryObjectQuery),
      (context) =>
        libraryRoute(context, async () => {
          const object = await service.get(
            context.get('actor').userId,
            context.req.valid('param').workspaceId,
            context.req.valid('query').path
          )
          if (!object) return context.json({ error: { code: 'not_found' as const } }, 404)
          return context.json({ object })
        })
    )
    .post(
      '/:workspaceId/library-objects/uploads',
      workspaceParams,
      validatedJSON(parseCreateLibraryUpload),
      (context) =>
        libraryRoute(context, async () =>
          context.json(
            await service.createUpload(
              context.get('actor').userId,
              context.req.valid('param').workspaceId,
              context.req.valid('json')
            ),
            201
          )
        )
    )
    .post(
      '/:workspaceId/library-objects/commits',
      workspaceParams,
      validatedJSON(parseCommitLibraryObject),
      (context) =>
        libraryRoute(context, async () =>
          context.json(
            await service.commit(
              context.get('actor').userId,
              context.req.valid('param').workspaceId,
              context.req.valid('json')
            )
          )
        )
    )
}

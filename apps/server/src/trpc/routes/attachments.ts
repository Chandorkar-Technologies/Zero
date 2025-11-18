import { privateProcedure, router } from '../trpc';
import { z } from 'zod';

// Note: This feature requires full message data which isn't currently stored in the database.
// For now, returning empty results. This will be implemented when message sync to DB is added.

export const attachmentsRouter = router({
  getAllAttachments: privateProcedure
    .input(
      z.object({
        connectionId: z.string(),
        fileType: z.enum(['all', 'images', 'documents', 'spreadsheets', 'other']).default('all'),
        limit: z.number().default(100),
      })
    )
    .query(async () => {
      // TODO: Implement attachment extraction when full message sync is available
      // For now, return empty array
      return [];
    }),

  getAttachmentStats: privateProcedure
    .input(
      z.object({
        connectionId: z.string(),
      })
    )
    .query(async () => {
      // TODO: Implement stats when full message sync is available
      return {
        total: 0,
        images: 0,
        documents: 0,
        spreadsheets: 0,
        other: 0,
        totalSize: 0,
      };
    }),
});

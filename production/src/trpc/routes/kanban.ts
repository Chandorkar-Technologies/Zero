import { privateProcedure, router } from '../trpc';
import { getZeroDB, getThread } from '../../lib/server-utils';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { connection } from '../../db/schema';

export const kanbanRouter = router({
  // Board operations
  createBoard: privateProcedure
    .input(
      z.object({
        connectionId: z.string(),
        name: z.string(),
        isDefault: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { connectionId, name, isDefault = false } = input;
      const { sessionUser } = ctx;

      console.log('[kanban.createBoard] Creating board:', { userId: sessionUser.id, connectionId, name });

      const db = await getZeroDB(sessionUser.id);

      // Verify the connection exists and belongs to the user
      const connection = await db.findUserConnection(connectionId);
      console.log('[kanban.createBoard] Connection lookup result:', {
        found: !!connection,
        connectionId: connection?.id,
        userId: connection?.userId,
        email: connection?.email,
      });

      if (!connection) {
        console.error('[kanban.createBoard] Connection not found:', { userId: sessionUser.id, connectionId });
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Connection not found. Please refresh the page and try again, or reconnect your email account.'
        });
      }

      // If this is set as default, unset other defaults for this connection
      if (isDefault) {
        const existingBoards = await db.getKanbanBoards(sessionUser.id, connectionId);
        for (const board of existingBoards.filter((b) => b.isDefault)) {
          await db.updateKanbanBoard(board.id, { isDefault: false });
        }
      }

      // Double-check the connection exists in all active connections
      const allConnections = await db.findManyConnections();
      console.log('[kanban.createBoard] All user connections:', {
        count: allConnections.length,
        connectionIds: allConnections.map(c => c.id),
        targetConnectionId: connectionId,
        exists: allConnections.some(c => c.id === connectionId),
      });

      // Verify the specific connection again
      const verifyConnection = await db.findUserConnection(connectionId);
      console.log('[kanban.createBoard] Verify connection before insert:', {
        found: !!verifyConnection,
        id: verifyConnection?.id,
        userId: verifyConnection?.userId,
        email: verifyConnection?.email,
      });

      if (!allConnections.some(c => c.id === connectionId) || !verifyConnection) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Connection not found in database. Please refresh the page and select a valid connection.'
        });
      }

      try {
        console.log('[kanban.createBoard] Creating board in database with:', {
          userId: sessionUser.id,
          connectionId,
          name,
          isDefault,
        });

        const [board] = await db.createKanbanBoard(connectionId, name, isDefault);

        // Create default columns: To Do, In Progress, Done
        await db.createKanbanColumn(board.id, 'To Do', '#ef4444', 0);
        await db.createKanbanColumn(board.id, 'In Progress', '#f59e0b', 1);
        await db.createKanbanColumn(board.id, 'Done', '#10b981', 2);

        console.log('[kanban.createBoard] Board created successfully:', board.id);
        return board;
      } catch (error: any) {
        console.error('[kanban.createBoard] Error creating board:', {
          error: error.message,
          stack: error.stack,
          connectionId,
          userId: sessionUser.id,
        });

        // Check if it's a foreign key constraint error
        if (error.message?.includes('violates foreign key constraint') ||
            error.message?.includes('mail0_kanban_board_connection_id_fkey')) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Invalid connection. The connection may have been deleted. Please refresh the page and reconnect your email account.'
          });
        }

        throw error;
      }
    }),

  getBoards: privateProcedure
    .input(
      z.object({
        connectionId: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { connectionId } = input;
      const { sessionUser } = ctx;

      console.log('[kanban.getBoards] Fetching boards:', { userId: sessionUser.id, connectionId });

      const db = await getZeroDB(sessionUser.id);
      const boards = await db.getKanbanBoards(connectionId);

      console.log('[kanban.getBoards] Found boards:', { count: boards.length, boards: boards.map(b => ({ id: b.id, name: b.name, connectionId: b.connectionId })) });

      return boards;
    }),

  getBoardWithColumns: privateProcedure
    .input(
      z.object({
        boardId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { boardId } = input;
      const { sessionUser } = ctx;

      const db = await getZeroDB(sessionUser.id);

      const board = await db.getKanbanBoardById(boardId);
      if (!board) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Board not found' });
      }

      // Verify ownership
      if (board.userId !== sessionUser.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
      }

      const columns = await db.getKanbanColumns(boardId);

      // Get connection info to determine provider type
      const { env } = await import('../../env');
      const { createDb } = await import('../../db');
      const { eq } = await import('drizzle-orm');
      const { db: dbInstance } = createDb(env.HYPERDRIVE.connectionString);

      const [connectionInfo] = await dbInstance
        .select({ providerId: connection.providerId })
        .from(connection)
        .where(eq(connection.id, board.connectionId))
        .limit(1);

      const isImapConnection = connectionInfo?.providerId === 'imap';

      // Get emails for each column with metadata
      const columnsWithEmails = await Promise.all(
        columns.map(async (column) => {
          const emails = await db.getKanbanEmailsByColumn(column.id);

          // Enrich each email with thread metadata
          const emailsWithMetadata = await Promise.all(
            emails.map(async (email) => {
              try {
                if (isImapConnection) {
                  // For IMAP connections, fetch from PostgreSQL database
                  const { email: emailSchema } = await import('../../db/schema');
                  const { and, eq: eqOp } = await import('drizzle-orm');

                  const dbEmails = await dbInstance.query.email.findMany({
                    where: and(
                      eqOp(emailSchema.threadId, email.threadId),
                      eqOp(emailSchema.connectionId, email.connectionId)
                    ),
                    limit: 1,
                    columns: {
                      subject: true,
                      snippet: true,
                      from: true,
                    },
                  });

                  const emailMeta = dbEmails[0];
                  const from = emailMeta?.from as { name?: string; address: string } | undefined;

                  return {
                    ...email,
                    subject: emailMeta?.subject || 'No Subject',
                    snippet: emailMeta?.snippet || '',
                    senderName: from?.name || '',
                    senderEmail: from?.address || '',
                  };
                } else {
                  // For OAuth connections (Google/Outlook), fetch from Durable Object
                  const threadResult = await getThread(email.connectionId, email.threadId);
                  const latestMessage = threadResult.result?.latest;

                  return {
                    ...email,
                    subject: latestMessage?.subject || 'No Subject',
                    snippet: latestMessage?.snippet || '',
                    senderName: latestMessage?.sender?.name || '',
                    senderEmail: latestMessage?.sender?.email || '',
                  };
                }
              } catch (error) {
                console.error('[getBoardWithColumns] Error fetching email metadata:', error);
                return {
                  ...email,
                  subject: 'No Subject',
                  snippet: '',
                  senderName: '',
                  senderEmail: '',
                };
              }
            })
          );

          return {
            ...column,
            emails: emailsWithMetadata,
          };
        }),
      );

      return {
        ...board,
        columns: columnsWithEmails,
      };
    }),

  updateBoard: privateProcedure
    .input(
      z.object({
        boardId: z.string(),
        name: z.string().optional(),
        isDefault: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { boardId, ...updates } = input;
      const { sessionUser } = ctx;

      const db = await getZeroDB(sessionUser.id);

      // Verify ownership
      const board = await db.getKanbanBoardById(boardId);
      if (!board || board.userId !== sessionUser.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
      }

      // If setting as default, unset others
      if (updates.isDefault) {
        const existingBoards = await db.getKanbanBoards(sessionUser.id, board.connectionId);
        for (const existingBoard of existingBoards.filter((b) => b.isDefault && b.id !== boardId)) {
          await db.updateKanbanBoard(existingBoard.id, { isDefault: false });
        }
      }

      const [updatedBoard] = await db.updateKanbanBoard(boardId, updates);
      return updatedBoard;
    }),

  deleteBoard: privateProcedure
    .input(
      z.object({
        boardId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { boardId } = input;
      const { sessionUser } = ctx;

      const db = await getZeroDB(sessionUser.id);

      // Verify ownership
      const board = await db.getKanbanBoardById(boardId);
      if (!board || board.userId !== sessionUser.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
      }

      await db.deleteKanbanBoard(boardId);
      return { success: true };
    }),

  // Column operations
  createColumn: privateProcedure
    .input(
      z.object({
        boardId: z.string(),
        name: z.string(),
        color: z.string().nullable(),
        position: z.number(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { boardId, name, color, position } = input;
      const { sessionUser } = ctx;

      const db = await getZeroDB(sessionUser.id);

      // Verify board ownership
      const board = await db.getKanbanBoardById(boardId);
      if (!board || board.userId !== sessionUser.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
      }

      const [column] = await db.createKanbanColumn(boardId, name, color, position);
      return column;
    }),

  updateColumn: privateProcedure
    .input(
      z.object({
        columnId: z.string(),
        name: z.string().optional(),
        color: z.string().nullable().optional(),
        position: z.number().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { columnId, ...updates } = input;
      const { sessionUser } = ctx;

      const db = await getZeroDB(sessionUser.id);

      // TODO: Verify ownership through board
      const [updatedColumn] = await db.updateKanbanColumn(columnId, updates);
      return updatedColumn;
    }),

  deleteColumn: privateProcedure
    .input(
      z.object({
        columnId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { columnId } = input;
      const { sessionUser } = ctx;

      const db = await getZeroDB(sessionUser.id);

      // TODO: Verify ownership through board
      await db.deleteKanbanColumn(columnId);
      return { success: true };
    }),

  // Email operations
  addEmailToColumn: privateProcedure
    .input(
      z.object({
        columnId: z.string(),
        threadId: z.string(),
        connectionId: z.string(),
        position: z.number(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { columnId, threadId, connectionId, position } = input;
      const { sessionUser } = ctx;

      console.log('[kanban.addEmailToColumn] Input:', { columnId, threadId, connectionId, position, userId: sessionUser.id });

      const db = await getZeroDB(sessionUser.id);

      // Verify the connection exists
      const connection = await db.findUserConnection(connectionId);
      if (!connection) {
        console.error('[kanban.addEmailToColumn] Connection not found:', connectionId);
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Connection ${connectionId} not found. Please refresh the page.`
        });
      }

      console.log('[kanban.addEmailToColumn] Connection found:', connection.email);

      // TODO: Verify ownership
      const [mapping] = await db.addEmailToKanbanColumn(columnId, threadId, connectionId, position);
      console.log('[kanban.addEmailToColumn] Created mapping:', mapping.id);
      return mapping;
    }),

  moveEmail: privateProcedure
    .input(
      z.object({
        threadId: z.string(),
        connectionId: z.string(),
        columnId: z.string(),
        position: z.number(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { threadId, connectionId, columnId, position } = input;
      const { sessionUser } = ctx;

      console.log('[kanban.moveEmail] Input:', { threadId, connectionId, columnId, position });

      const db = await getZeroDB(sessionUser.id);

      // Verify the connection exists
      const connection = await db.findUserConnection(connectionId);
      console.log('[kanban.moveEmail] Connection lookup:', {
        connectionId,
        found: !!connection,
        email: connection?.email
      });

      if (!connection) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Connection ${connectionId} not found. The email account may have been disconnected.`
        });
      }

      // Check if email already has a mapping
      const existing = await db.getKanbanEmailMapping(threadId, connectionId);

      if (existing) {
        // Update existing mapping
        const [updated] = await db.updateKanbanEmailPosition(
          threadId,
          connectionId,
          columnId,
          position,
        );
        return updated;
      } else {
        // Create new mapping
        const [mapping] = await db.addEmailToKanbanColumn(columnId, threadId, connectionId, position);
        return mapping;
      }
    }),

  removeEmail: privateProcedure
    .input(
      z.object({
        threadId: z.string(),
        connectionId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { threadId, connectionId } = input;
      const { sessionUser } = ctx;

      const db = await getZeroDB(sessionUser.id);

      await db.removeEmailFromKanban(threadId, connectionId);
      return { success: true };
    }),
});

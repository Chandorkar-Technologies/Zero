/**
 * Worker 3: TRPC Worker
 *
 * This worker handles:
 * - /api/* routes (TRPC, AI, Drive, Razorpay, IMAP, etc.)
 * - /mcp/* routes (MCP server)
 * - /sse/* routes (Server-sent events for MCP)
 * - All Durable Object bindings
 */

import {
  createUpdatedMatrixFromNewEmail,
  initializeStyleMatrixFromEmail,
  type EmailMatrix,
  type WritingStyleMatrix,
} from '../services/writing-style-service';
import {
  account,
  connection,
  note,
  session,
  subscription,
  user,
  userHotkeys,
  userSettings,
  writingStyleMatrix,
  emailTemplate,
  kanbanBoard,
  kanbanColumn,
  kanbanEmailMapping,
} from '../db/schema';
import { DurableObject, RpcTarget } from 'cloudflare:workers';
import { getZeroDB } from '../lib/server-utils';
import { SyncThreadsWorkflow } from '../workflows/sync-threads-workflow';
import { SyncThreadsCoordinatorWorkflow } from '../workflows/sync-threads-coordinator-workflow';
import { ShardRegistry, ZeroAgent, ZeroDriver } from '../routes/agent';
import { ThreadSyncWorker } from '../routes/agent/sync-worker';
import { EProviders } from '../types';
import { eq, and, desc, asc, inArray } from 'drizzle-orm';
import { ThinkingMCP } from '../lib/sequential-thinking';
import { contextStorage } from 'hono/context-storage';
import { defaultUserSettings } from '../lib/schemas';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { trpcServer } from '@hono/trpc-server';
import { agentsMiddleware } from 'hono-agents';
import { ZeroMCP } from '../routes/agent/mcp';
import { publicRouter } from '../routes/auth';
import { WorkflowRunner } from '../pipelines';
import { razorpayApi } from '../routes/razorpay';
import type { ZeroEnv } from '../env';
import type { HonoContext } from '../ctx';
import { createDb, type DB } from '../db';
import { createAuth } from '../lib/auth';
import { aiRouter } from '../routes/ai';
import { appRouter } from '../trpc';
import { cors } from 'hono/cors';
import { oAuthDiscoveryMetadata } from 'better-auth/plugins';
import { Effect } from 'effect';
import { Hono } from 'hono';
import { imapRouter } from '../routes/imap';
import { driveApiRouter } from '../routes/drive';
import { verifyToken } from '../lib/server-utils';
import { initTracing } from '../lib/tracing';
import { env } from '../env';

// Sentry tunnel configuration
const SENTRY_HOST = 'o4509328786915328.ingest.us.sentry.io';
const SENTRY_PROJECT_IDS = new Set(['4509328795303936']);

export class DbRpcDO extends RpcTarget {
  constructor(
    private mainDo: ZeroDB,
    private userId: string,
  ) {
    super();
  }

  async findUser(): Promise<typeof user.$inferSelect | undefined> {
    return await this.mainDo.findUser(this.userId);
  }

  async findUserConnection(
    connectionId: string,
  ): Promise<typeof connection.$inferSelect | undefined> {
    return await this.mainDo.findUserConnection(this.userId, connectionId);
  }

  async updateUser(data: Partial<typeof user.$inferInsert>) {
    return await this.mainDo.updateUser(this.userId, data);
  }

  async deleteConnection(connectionId: string) {
    return await this.mainDo.deleteConnection(connectionId, this.userId);
  }

  async findFirstConnection(): Promise<typeof connection.$inferSelect | undefined> {
    return await this.mainDo.findFirstConnection(this.userId);
  }

  async findManyConnections(): Promise<(typeof connection.$inferSelect)[]> {
    return await this.mainDo.findManyConnections(this.userId);
  }

  async findManyNotesByThreadId(threadId: string): Promise<(typeof note.$inferSelect)[]> {
    return await this.mainDo.findManyNotesByThreadId(this.userId, threadId);
  }

  async createNote(payload: Omit<typeof note.$inferInsert, 'userId'>) {
    return await this.mainDo.createNote(this.userId, payload as typeof note.$inferInsert);
  }

  async updateNote(noteId: string, payload: Partial<typeof note.$inferInsert>) {
    return await this.mainDo.updateNote(this.userId, noteId, payload);
  }

  async updateManyNotes(
    notes: { id: string; order: number; isPinned?: boolean | null }[],
  ): Promise<boolean> {
    return await this.mainDo.updateManyNotes(this.userId, notes);
  }

  async findManyNotesByIds(noteIds: string[]): Promise<(typeof note.$inferSelect)[]> {
    return await this.mainDo.findManyNotesByIds(this.userId, noteIds);
  }

  async deleteNote(noteId: string) {
    return await this.mainDo.deleteNote(this.userId, noteId);
  }

  async findNoteById(noteId: string): Promise<typeof note.$inferSelect | undefined> {
    return await this.mainDo.findNoteById(this.userId, noteId);
  }

  async findHighestNoteOrder(): Promise<{ order: number } | undefined> {
    return await this.mainDo.findHighestNoteOrder(this.userId);
  }

  async deleteUser() {
    return await this.mainDo.deleteUser(this.userId);
  }

  async findUserSettings(): Promise<typeof userSettings.$inferSelect | undefined> {
    return await this.mainDo.findUserSettings(this.userId);
  }

  async findUserHotkeys(): Promise<(typeof userHotkeys.$inferSelect)[]> {
    return await this.mainDo.findUserHotkeys(this.userId);
  }

  async insertUserHotkeys(shortcuts: (typeof userHotkeys.$inferInsert)[]) {
    return await this.mainDo.insertUserHotkeys(this.userId, shortcuts);
  }

  async insertUserSettings(settings: typeof defaultUserSettings) {
    return await this.mainDo.insertUserSettings(this.userId, settings);
  }

  async updateUserSettings(settings: typeof defaultUserSettings) {
    return await this.mainDo.updateUserSettings(this.userId, settings);
  }

  async createConnection(
    providerId: EProviders,
    email: string,
    updatingInfo: {
      expiresAt: Date;
      scope: string;
    },
  ): Promise<{ id: string }[]> {
    return await this.mainDo.createConnection(providerId, email, this.userId, updatingInfo);
  }

  async findConnectionById(
    connectionId: string,
  ): Promise<typeof connection.$inferSelect | undefined> {
    return await this.mainDo.findConnectionById(connectionId);
  }

  async syncUserMatrix(connectionId: string, emailStyleMatrix: EmailMatrix) {
    return await this.mainDo.syncUserMatrix(connectionId, emailStyleMatrix);
  }

  async findWritingStyleMatrix(
    connectionId: string,
  ): Promise<typeof writingStyleMatrix.$inferSelect | undefined> {
    return await this.mainDo.findWritingStyleMatrix(connectionId);
  }

  async deleteActiveConnection(connectionId: string) {
    return await this.mainDo.deleteActiveConnection(this.userId, connectionId);
  }

  async updateConnection(
    connectionId: string,
    updatingInfo: Partial<typeof connection.$inferInsert>,
  ) {
    return await this.mainDo.updateConnection(connectionId, updatingInfo);
  }

  async listEmailTemplates(): Promise<(typeof emailTemplate.$inferSelect)[]> {
    return await this.mainDo.findManyEmailTemplates(this.userId);
  }

  async createEmailTemplate(payload: Omit<typeof emailTemplate.$inferInsert, 'userId'>) {
    return await this.mainDo.createEmailTemplate(this.userId, payload);
  }

  async deleteEmailTemplate(templateId: string) {
    return await this.mainDo.deleteEmailTemplate(this.userId, templateId);
  }

  async updateEmailTemplate(templateId: string, data: Partial<typeof emailTemplate.$inferInsert>) {
    return await this.mainDo.updateEmailTemplate(this.userId, templateId, data);
  }

  async findSubscription() {
    return await this.mainDo.findSubscription(this.userId);
  }

  async insertSubscription(data: typeof subscription.$inferInsert) {
    return await this.mainDo.insertSubscription(data);
  }

  async updateSubscription(data: Partial<typeof subscription.$inferInsert>) {
    return await this.mainDo.updateSubscription(this.userId, data);
  }

  async deleteSubscription() {
    return await this.mainDo.deleteSubscription(this.userId);
  }

  async updateSubscriptionByRazorpayId(razorpaySubscriptionId: string, data: Partial<typeof subscription.$inferInsert>) {
    return await this.mainDo.updateSubscriptionByRazorpayId(razorpaySubscriptionId, data);
  }

  async createKanbanBoard(connectionId: string, name: string, isDefault: boolean = false) {
    return await this.mainDo.createKanbanBoard(this.userId, connectionId, name, isDefault);
  }

  async getKanbanBoards(connectionId?: string) {
    return await this.mainDo.getKanbanBoards(this.userId, connectionId);
  }

  async getKanbanBoardById(boardId: string) {
    return await this.mainDo.getKanbanBoardById(boardId);
  }

  async updateKanbanBoard(boardId: string, updates: Partial<typeof kanbanBoard.$inferInsert>) {
    return await this.mainDo.updateKanbanBoard(boardId, updates);
  }

  async deleteKanbanBoard(boardId: string) {
    return await this.mainDo.deleteKanbanBoard(boardId);
  }

  async createKanbanColumn(boardId: string, name: string, color: string | null, position: number) {
    return await this.mainDo.createKanbanColumn(boardId, name, color, position);
  }

  async getKanbanColumns(boardId: string) {
    return await this.mainDo.getKanbanColumns(boardId);
  }

  async updateKanbanColumn(columnId: string, updates: Partial<typeof kanbanColumn.$inferInsert>) {
    return await this.mainDo.updateKanbanColumn(columnId, updates);
  }

  async deleteKanbanColumn(columnId: string) {
    return await this.mainDo.deleteKanbanColumn(columnId);
  }

  async addEmailToKanbanColumn(columnId: string, threadId: string, connectionId: string, position: number) {
    return await this.mainDo.addEmailToKanbanColumn(columnId, threadId, connectionId, position);
  }

  async removeEmailFromKanban(threadId: string, connectionId: string) {
    return await this.mainDo.removeEmailFromKanban(threadId, connectionId);
  }

  async getKanbanEmailsByColumn(columnId: string) {
    return await this.mainDo.getKanbanEmailsByColumn(columnId);
  }

  async getKanbanEmailMapping(threadId: string, connectionId: string) {
    return await this.mainDo.getKanbanEmailMapping(threadId, connectionId);
  }

  async updateKanbanEmailPosition(threadId: string, connectionId: string, columnId: string, position: number) {
    return await this.mainDo.updateKanbanEmailPosition(threadId, connectionId, columnId, position);
  }

  get rawDb() {
    return this.mainDo.db;
  }
}

class ZeroDB extends DurableObject<ZeroEnv> {
  private _db: DB | null = null;

  get db(): DB {
    if (!this._db) {
      this._db = createDb(this.env.HYPERDRIVE.connectionString).db;
    }
    return this._db;
  }

  async setMetaData(userId: string) {
    return new DbRpcDO(this, userId);
  }

  async findUser(userId: string): Promise<typeof user.$inferSelect | undefined> {
    return await this.db.query.user.findFirst({
      where: eq(user.id, userId),
    });
  }

  async findUserConnection(
    userId: string,
    connectionId: string,
  ): Promise<typeof connection.$inferSelect | undefined> {
    return await this.db.query.connection.findFirst({
      where: and(eq(connection.userId, userId), eq(connection.id, connectionId)),
    });
  }

  async updateUser(userId: string, data: Partial<typeof user.$inferInsert>) {
    return await this.db.update(user).set(data).where(eq(user.id, userId));
  }

  async deleteConnection(connectionId: string, userId: string) {
    const connections = await this.findManyConnections(userId);
    if (connections.length <= 1) {
      throw new Error('Cannot delete the last connection. At least one connection is required.');
    }
    return await this.db
      .delete(connection)
      .where(and(eq(connection.id, connectionId), eq(connection.userId, userId)));
  }

  async findFirstConnection(userId: string): Promise<typeof connection.$inferSelect | undefined> {
    return await this.db.query.connection.findFirst({
      where: eq(connection.userId, userId),
    });
  }

  async findManyConnections(userId: string): Promise<(typeof connection.$inferSelect)[]> {
    const connections = await this.db.query.connection.findMany({
      where: eq(connection.userId, userId),
    });

    // Debug: Log each connection's token state
    console.log('[ZeroDB.findManyConnections] Raw query results:', connections.map(c => ({
      id: c.id,
      email: c.email,
      providerId: c.providerId,
      hasAccessToken: !!c.accessToken,
      hasRefreshToken: !!c.refreshToken,
      accessTokenLength: c.accessToken?.length,
      refreshTokenLength: c.refreshToken?.length,
    })));

    return connections;
  }

  async createKanbanBoard(
    userId: string,
    connectionId: string,
    name: string,
    isDefault: boolean = false,
  ) {
    const boardId = crypto.randomUUID();
    return await this.db.insert(kanbanBoard).values({
      id: boardId,
      userId,
      connectionId,
      name,
      isDefault,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
  }

  async getKanbanBoards(userId: string, connectionId?: string) {
    if (connectionId) {
      return await this.db.query.kanbanBoard.findMany({
        where: and(
          eq(kanbanBoard.userId, userId),
          eq(kanbanBoard.connectionId, connectionId),
        ),
        orderBy: [desc(kanbanBoard.isDefault), asc(kanbanBoard.createdAt)],
      });
    }
    return await this.db.query.kanbanBoard.findMany({
      where: eq(kanbanBoard.userId, userId),
      orderBy: [desc(kanbanBoard.isDefault), asc(kanbanBoard.createdAt)],
    });
  }

  async getKanbanBoardById(boardId: string) {
    return await this.db.query.kanbanBoard.findFirst({
      where: eq(kanbanBoard.id, boardId),
    });
  }

  async updateKanbanBoard(
    boardId: string,
    updates: Partial<typeof kanbanBoard.$inferInsert>,
  ) {
    return await this.db
      .update(kanbanBoard)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(kanbanBoard.id, boardId))
      .returning();
  }

  async deleteKanbanBoard(boardId: string) {
    return await this.db.delete(kanbanBoard).where(eq(kanbanBoard.id, boardId));
  }

  async createKanbanColumn(
    boardId: string,
    name: string,
    color: string | null,
    position: number,
  ) {
    return await this.db.insert(kanbanColumn).values({
      id: crypto.randomUUID(),
      boardId,
      name,
      color,
      position,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
  }

  async getKanbanColumns(boardId: string) {
    return await this.db.query.kanbanColumn.findMany({
      where: eq(kanbanColumn.boardId, boardId),
      orderBy: [asc(kanbanColumn.position)],
    });
  }

  async updateKanbanColumn(
    columnId: string,
    updates: Partial<typeof kanbanColumn.$inferInsert>,
  ) {
    return await this.db
      .update(kanbanColumn)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(kanbanColumn.id, columnId))
      .returning();
  }

  async deleteKanbanColumn(columnId: string) {
    return await this.db.delete(kanbanColumn).where(eq(kanbanColumn.id, columnId));
  }

  async addEmailToKanbanColumn(
    columnId: string,
    threadId: string,
    connectionId: string,
    position: number,
  ) {
    await this.db.delete(kanbanEmailMapping).where(
      and(
        eq(kanbanEmailMapping.threadId, threadId),
        eq(kanbanEmailMapping.connectionId, connectionId),
      ),
    );

    return await this.db.insert(kanbanEmailMapping).values({
      id: crypto.randomUUID(),
      columnId,
      threadId,
      connectionId,
      position,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
  }

  async removeEmailFromKanban(threadId: string, connectionId: string) {
    return await this.db.delete(kanbanEmailMapping).where(
      and(
        eq(kanbanEmailMapping.threadId, threadId),
        eq(kanbanEmailMapping.connectionId, connectionId),
      ),
    );
  }

  async getKanbanEmailsByColumn(columnId: string) {
    return await this.db.query.kanbanEmailMapping.findMany({
      where: eq(kanbanEmailMapping.columnId, columnId),
      orderBy: [asc(kanbanEmailMapping.position)],
    });
  }

  async getKanbanEmailMapping(threadId: string, connectionId: string) {
    return await this.db.query.kanbanEmailMapping.findFirst({
      where: and(
        eq(kanbanEmailMapping.threadId, threadId),
        eq(kanbanEmailMapping.connectionId, connectionId),
      ),
    });
  }

  async updateKanbanEmailPosition(
    threadId: string,
    connectionId: string,
    columnId: string,
    position: number,
  ) {
    return await this.db
      .update(kanbanEmailMapping)
      .set({ columnId, position, updatedAt: new Date() })
      .where(
        and(
          eq(kanbanEmailMapping.threadId, threadId),
          eq(kanbanEmailMapping.connectionId, connectionId),
        ),
      )
      .returning();
  }

  async findManyNotesByThreadId(
    userId: string,
    threadId: string,
  ): Promise<(typeof note.$inferSelect)[]> {
    return await this.db.query.note.findMany({
      where: and(eq(note.userId, userId), eq(note.threadId, threadId)),
      orderBy: [desc(note.isPinned), asc(note.order), desc(note.createdAt)],
    });
  }

  async createNote(userId: string, payload: typeof note.$inferInsert) {
    return await this.db
      .insert(note)
      .values({
        ...payload,
        userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
  }

  async updateNote(
    userId: string,
    noteId: string,
    payload: Partial<typeof note.$inferInsert>,
  ): Promise<typeof note.$inferSelect | undefined> {
    const [updated] = await this.db
      .update(note)
      .set({
        ...payload,
        updatedAt: new Date(),
      })
      .where(and(eq(note.id, noteId), eq(note.userId, userId)))
      .returning();
    return updated;
  }

  async updateManyNotes(
    userId: string,
    notes: { id: string; order: number; isPinned?: boolean | null }[],
  ): Promise<boolean> {
    return await this.db.transaction(async (tx) => {
      for (const n of notes) {
        const updateData: Record<string, unknown> = {
          order: n.order,
          updatedAt: new Date(),
        };

        if (n.isPinned !== undefined) {
          updateData.isPinned = n.isPinned;
        }
        await tx
          .update(note)
          .set(updateData)
          .where(and(eq(note.id, n.id), eq(note.userId, userId)));
      }
      return true;
    });
  }

  async findManyNotesByIds(
    userId: string,
    noteIds: string[],
  ): Promise<(typeof note.$inferSelect)[]> {
    return await this.db.query.note.findMany({
      where: and(eq(note.userId, userId), inArray(note.id, noteIds)),
    });
  }

  async deleteNote(userId: string, noteId: string) {
    return await this.db.delete(note).where(and(eq(note.id, noteId), eq(note.userId, userId)));
  }

  async findNoteById(
    userId: string,
    noteId: string,
  ): Promise<typeof note.$inferSelect | undefined> {
    return await this.db.query.note.findFirst({
      where: and(eq(note.id, noteId), eq(note.userId, userId)),
    });
  }

  async findHighestNoteOrder(userId: string): Promise<{ order: number } | undefined> {
    return await this.db.query.note.findFirst({
      where: eq(note.userId, userId),
      orderBy: desc(note.order),
      columns: { order: true },
    });
  }

  async deleteUser(userId: string) {
    return await this.db.transaction(async (tx) => {
      await tx.delete(connection).where(eq(connection.userId, userId));
      await tx.delete(account).where(eq(account.userId, userId));
      await tx.delete(session).where(eq(session.userId, userId));
      await tx.delete(userSettings).where(eq(userSettings.userId, userId));
      await tx.delete(user).where(eq(user.id, userId));
      await tx.delete(userHotkeys).where(eq(userHotkeys.userId, userId));
    });
  }

  async findUserSettings(userId: string): Promise<typeof userSettings.$inferSelect | undefined> {
    return await this.db.query.userSettings.findFirst({
      where: eq(userSettings.userId, userId),
    });
  }

  async findUserHotkeys(userId: string): Promise<(typeof userHotkeys.$inferSelect)[]> {
    return await this.db.query.userHotkeys.findMany({
      where: eq(userHotkeys.userId, userId),
    });
  }

  async insertUserHotkeys(userId: string, shortcuts: (typeof userHotkeys.$inferInsert)[]) {
    return await this.db
      .insert(userHotkeys)
      .values({
        userId,
        shortcuts,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userHotkeys.userId,
        set: {
          shortcuts,
          updatedAt: new Date(),
        },
      });
  }

  async insertUserSettings(userId: string, settings: typeof defaultUserSettings) {
    return await this.db.insert(userSettings).values({
      id: crypto.randomUUID(),
      userId,
      settings,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async updateUserSettings(userId: string, settings: typeof defaultUserSettings) {
    return await this.db
      .insert(userSettings)
      .values({
        id: crypto.randomUUID(),
        userId,
        settings,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: {
          settings,
          updatedAt: new Date(),
        },
      });
  }

  async createConnection(
    providerId: EProviders,
    email: string,
    userId: string,
    updatingInfo: {
      expiresAt: Date;
      scope: string;
    },
  ): Promise<{ id: string }[]> {
    console.log('[ZeroDB.createConnection] Called with:', {
      providerId,
      email,
      userId,
      hasAccessToken: !!updatingInfo.accessToken,
      hasRefreshToken: !!updatingInfo.refreshToken,
      accessTokenLength: updatingInfo.accessToken?.length,
      refreshTokenLength: updatingInfo.refreshToken?.length,
      scope: updatingInfo.scope,
    });

    // Check if connection already exists
    const existingConnection = await this.db.query.connection.findFirst({
      where: and(eq(connection.email, email), eq(connection.userId, userId)),
    });

    console.log('[ZeroDB.createConnection] EXISTING connection:', {
      exists: !!existingConnection,
      existingId: existingConnection?.id,
      existingHasAccessToken: !!existingConnection?.accessToken,
      existingHasRefreshToken: !!existingConnection?.refreshToken,
      existingProviderId: existingConnection?.providerId,
    });

    let result: { id: string }[];

    if (existingConnection) {
      // UPDATE existing connection - only update provided fields
      const updateFields: Partial<typeof connection.$inferInsert> = {
        name: updatingInfo.name,
        picture: updatingInfo.picture,
        scope: updatingInfo.scope,
        expiresAt: updatingInfo.expiresAt,
        updatedAt: new Date(),
      };

      // Only update tokens if they're explicitly provided (not undefined)
      if (updatingInfo.accessToken !== undefined) {
        updateFields.accessToken = updatingInfo.accessToken;
      }
      if (updatingInfo.refreshToken !== undefined) {
        updateFields.refreshToken = updatingInfo.refreshToken;
      }

      console.log('[ZeroDB.createConnection] UPDATING existing connection:', {
        connectionId: existingConnection.id,
        updateKeys: Object.keys(updateFields),
        hasAccessTokenInUpdate: 'accessToken' in updateFields,
        hasRefreshTokenInUpdate: 'refreshToken' in updateFields,
      });

      await this.db
        .update(connection)
        .set(updateFields)
        .where(eq(connection.id, existingConnection.id));

      result = [{ id: existingConnection.id }];
    } else {
      // INSERT new connection
      console.log('[ZeroDB.createConnection] INSERTING new connection');

      result = await this.db
        .insert(connection)
        .values({
          id: crypto.randomUUID(),
          providerId,
          email,
          userId,
          name: updatingInfo.name,
          picture: updatingInfo.picture,
          scope: updatingInfo.scope,
          expiresAt: updatingInfo.expiresAt,
          accessToken: updatingInfo.accessToken,
          refreshToken: updatingInfo.refreshToken,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning({ id: connection.id });
    }

    // Check connection AFTER operation
    const afterConnection = await this.db.query.connection.findFirst({
      where: eq(connection.id, result[0]?.id),
    });
    console.log('[ZeroDB.createConnection] AFTER operation:', {
      connectionId: result[0]?.id,
      providerId,
      email,
      afterHasAccessToken: !!afterConnection?.accessToken,
      afterHasRefreshToken: !!afterConnection?.refreshToken,
    });

    return result;
  }

  async findConnectionById(
    connectionId: string,
  ): Promise<typeof connection.$inferSelect | undefined> {
    return await this.db.query.connection.findFirst({
      where: eq(connection.id, connectionId),
    });
  }

  async syncUserMatrix(connectionId: string, emailStyleMatrix: EmailMatrix) {
    await this.db.transaction(async (tx) => {
      const [existingMatrix] = await tx
        .select({
          numMessages: writingStyleMatrix.numMessages,
          style: writingStyleMatrix.style,
        })
        .from(writingStyleMatrix)
        .where(eq(writingStyleMatrix.connectionId, connectionId));

      if (existingMatrix) {
        const newStyle = createUpdatedMatrixFromNewEmail(
          existingMatrix.numMessages,
          existingMatrix.style as WritingStyleMatrix,
          emailStyleMatrix,
        );

        await tx
          .update(writingStyleMatrix)
          .set({
            numMessages: existingMatrix.numMessages + 1,
            style: newStyle,
          })
          .where(eq(writingStyleMatrix.connectionId, connectionId));
      } else {
        const newStyle = initializeStyleMatrixFromEmail(emailStyleMatrix);

        await tx
          .insert(writingStyleMatrix)
          .values({
            connectionId,
            numMessages: 1,
            style: newStyle,
          })
          .onConflictDoNothing();
      }
    });
  }

  async findWritingStyleMatrix(
    connectionId: string,
  ): Promise<typeof writingStyleMatrix.$inferSelect | undefined> {
    return await this.db.query.writingStyleMatrix.findFirst({
      where: eq(writingStyleMatrix.connectionId, connectionId),
      columns: {
        numMessages: true,
        style: true,
        updatedAt: true,
        connectionId: true,
      },
    });
  }

  async deleteActiveConnection(userId: string, connectionId: string) {
    return await this.db
      .delete(connection)
      .where(and(eq(connection.userId, userId), eq(connection.id, connectionId)));
  }

  async updateConnection(
    connectionId: string,
    updatingInfo: Partial<typeof connection.$inferInsert>,
  ) {
    return await this.db
      .update(connection)
      .set(updatingInfo)
      .where(eq(connection.id, connectionId));
  }

  async findManyEmailTemplates(userId: string): Promise<(typeof emailTemplate.$inferSelect)[]> {
    return await this.db.query.emailTemplate.findMany({
      where: eq(emailTemplate.userId, userId),
      orderBy: desc(emailTemplate.updatedAt),
    });
  }

  async createEmailTemplate(
    userId: string,
    payload: Omit<typeof emailTemplate.$inferInsert, 'userId'>,
  ) {
    return await this.db
      .insert(emailTemplate)
      .values({
        ...payload,
        userId,
        id: crypto.randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
  }

  async deleteEmailTemplate(userId: string, templateId: string) {
    return await this.db
      .delete(emailTemplate)
      .where(and(eq(emailTemplate.id, templateId), eq(emailTemplate.userId, userId)));
  }

  async updateEmailTemplate(
    userId: string,
    templateId: string,
    data: Partial<typeof emailTemplate.$inferInsert>,
  ) {
    return await this.db
      .update(emailTemplate)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(emailTemplate.id, templateId), eq(emailTemplate.userId, userId)))
      .returning();
  }

  async findSubscription(userId: string): Promise<typeof subscription.$inferSelect | undefined> {
    return await this.db.query.subscription.findFirst({
      where: eq(subscription.userId, userId),
      orderBy: [desc(subscription.createdAt)],
    });
  }

  async insertSubscription(data: typeof subscription.$inferInsert) {
    return await this.db
      .insert(subscription)
      .values(data)
      .returning();
  }

  async updateSubscription(userId: string, data: Partial<typeof subscription.$inferInsert>) {
    return await this.db
      .update(subscription)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(subscription.userId, userId))
      .returning();
  }

  async deleteSubscription(userId: string) {
    return Effect.tryPromise({
      try: async () => {
        return await this.db
          .delete(subscription)
          .where(eq(subscription.userId, userId));
      },
      catch: (error: unknown) => new Error(`Failed to delete subscription: ${error}`),
    });
  }

  async updateSubscriptionByRazorpayId(razorpaySubscriptionId: string, data: Partial<typeof subscription.$inferInsert>) {
    return await this.db
      .update(subscription)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(subscription.razorpaySubscriptionId, razorpaySubscriptionId))
      .returning();
  }
}

// Utility function to hash IP addresses for PII protection
function hashIpAddress(ip: string | undefined): string | undefined {
  if (!ip) return undefined;

  const salt = 'zero-mail-ip-salt-2024';
  let hash = 0;
  const str = ip + salt;

  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }

  return `ip_${Math.abs(hash).toString(16).padStart(8, '0')}`;
}

const api = new Hono<HonoContext>()
  .use(contextStorage())
  .use('*', async (c, next) => {
    const traceId = c.req.header('X-Trace-ID') || crypto.randomUUID();
    const requestId = c.req.header('X-Request-Id') || crypto.randomUUID();

    c.header('X-Trace-ID', traceId);
    c.header('X-Request-ID', requestId);

    c.set('traceId', traceId);
    c.set('requestId', requestId);

    const { TraceContext } = await import('../lib/trace-context');

    const rawIp = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For');
    const trace = TraceContext.createTrace(traceId, {
      requestId,
      ip: hashIpAddress(rawIp),
      userAgent: c.req.header('User-Agent'),
    });

    const authSpan = TraceContext.startSpan(traceId, 'authentication', {
      method: c.req.method,
      url: c.req.url,
      hasAuthHeader: !!c.req.header('Authorization'),
    }, {
      'auth.method': c.req.header('Authorization') ? 'bearer_token' : 'session_cookie'
    });

    const auth = createAuth();
    c.set('auth', auth);

    try {
      if (c.env.HYPERDRIVE?.connectionString) {
        const result = createDb(c.env.HYPERDRIVE.connectionString);
        const db = result.db;

        if (!db || typeof db.select !== 'function') {
          throw new Error('createDb returned invalid database instance - missing select method');
        }

        c.set('db', db);
      } else {
        c.set('db', null as any);
      }
    } catch (e) {
      console.error('[DB_MIDDLEWARE] Failed to create DB connection:', e);
      c.set('db', null as any);
    }

    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    c.set('sessionUser', session?.user);

    if (c.req.header('Authorization') && !session?.user) {
      const tokenSpan = TraceContext.startSpan(traceId, 'token_verification', {
        tokenPresent: true,
      }, {
        'auth.token_type': 'jwt'
      });

      const token = c.req.header('Authorization')?.split(' ')[1];

      if (token) {
        try {
          const localJwks = await auth.api.getJwks();
          const jwks = createLocalJWKSet(localJwks);

          const { payload } = await jwtVerify(token, jwks);
          const userId = payload.sub;

          if (userId) {
            const db = await getZeroDB(userId);
            const user = await db.findUser();
            c.set('sessionUser', user);

            TraceContext.completeSpan(traceId, tokenSpan.id, {
              success: true,
              userId,
            });
          } else {
            TraceContext.completeSpan(traceId, tokenSpan.id, {
              success: false,
              reason: 'no_user_id_in_token',
            });
          }
        } catch (error) {
          TraceContext.completeSpan(traceId, tokenSpan.id, {
            success: false,
            reason: 'token_verification_failed',
          }, error instanceof Error ? error.message : 'Unknown token error');
        }
      } else {
        TraceContext.completeSpan(traceId, tokenSpan.id, {
          success: false,
          reason: 'no_token_provided',
        });
      }
    }

    TraceContext.completeSpan(traceId, authSpan.id, {
      authenticated: !!c.var.sessionUser,
      userId: c.var.sessionUser?.id,
      authMethod: session?.user ? 'session' : (c.req.header('Authorization') ? 'token' : 'none'),
    });

    trace.metadata.userId = c.var.sessionUser?.id;
    trace.metadata.sessionId = c.var.sessionUser?.id || 'anonymous';

    const requestSpan = TraceContext.startSpan(traceId, 'request_processing', {
      authenticated: !!c.var.sessionUser,
      path: new URL(c.req.url).pathname,
    });

    try {
      await next();
    } catch (error) {
      TraceContext.completeSpan(traceId, requestSpan.id, {
        success: false,
        statusCode: c.res.status,
      }, error instanceof Error ? error.message : 'Unknown request error');
      throw error;
    }

    c.set('sessionUser', undefined);
    c.set('auth', undefined as any);
  })
  .route('/ai', aiRouter)
  .route('/connections/imap', imapRouter)
  .route('/drive', driveApiRouter)
  .route('/razorpay', razorpayApi)
  .route('/public', publicRouter)
  // Sentry tunnel for error reporting
  .post('/monitoring/sentry', async (c) => {
    try {
      const envelopeBytes = await c.req.arrayBuffer();
      const envelope = new TextDecoder().decode(envelopeBytes);
      const piece = envelope.split('\n')[0];
      const header = JSON.parse(piece);
      const dsn = new URL(header['dsn']);
      const project_id = dsn.pathname?.replace('/', '');

      if (dsn.hostname !== SENTRY_HOST) {
        throw new Error(`Invalid sentry hostname: ${dsn.hostname}`);
      }

      if (!project_id || !SENTRY_PROJECT_IDS.has(project_id)) {
        throw new Error(`Invalid sentry project id: ${project_id}`);
      }

      const upstream_sentry_url = `https://${SENTRY_HOST}/api/${project_id}/envelope/`;
      await fetch(upstream_sentry_url, {
        method: 'POST',
        body: envelopeBytes,
      });

      return c.json({}, { status: 200 });
    } catch (e) {
      console.error('error tunneling to sentry', e);
      return c.json({ error: 'error tunneling to sentry' }, { status: 500 });
    }
  })
  // Auth routes - delegate to better-auth
  .on(['GET', 'POST', 'OPTIONS'], '/auth/*', (c) => {
    return c.var.auth.handler(c.req.raw);
  })
  .use(
    '/trpc/*',
    async (c, next) => {
      console.log('TRPC Request:', {
        path: c.req.path,
        url: c.req.url,
        method: c.req.method,
        matched: c.req.routePath,
      });
      await next();
    },
    trpcServer({
      endpoint: '/api/trpc',
      router: appRouter,
      createContext: (_, c) => {
        return { c, sessionUser: c.var['sessionUser'], db: c.var['db'] };
      },
      allowMethodOverride: true,
      onError: (opts) => {
        console.error('Error in TRPC handler:', opts.error);
      },
    }),
  )
  .onError(async (err, c) => {
    if (err instanceof Response) return err;
    console.error('Error in Hono handler:', err);
    return c.json(
      {
        error: 'Internal Server Error',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
      500,
    );
  });

const app = new Hono<HonoContext>()
  .use(
    '*',
    cors({
      origin: (origin, c) => {
        if (!origin) return null;
        if (origin === 'http://localhost:3000') return origin;

        let hostname: string;
        try {
          hostname = new URL(origin).hostname;
        } catch {
          return null;
        }
        const cookieDomain = c.env.COOKIE_DOMAIN;
        if (!cookieDomain) return null;
        const domain = cookieDomain.startsWith('.') ? cookieDomain.substring(1) : cookieDomain;
        if (hostname === domain || hostname.endsWith('.' + domain)) {
          return origin;
        }
        return null;
      },
      credentials: true,
      allowHeaders: ['Content-Type', 'Authorization'],
      exposeHeaders: ['X-Zero-Redirect'],
    }),
  )
  .get('/health', (c) => c.json({ message: 'Nubo TRPC Worker is Up!' }))
  // Google Pub/Sub notification endpoint for Gmail sync
  .post('/a8n/notify/:providerId', async (c) => {
    const tracer = initTracing();
    const span = tracer.startSpan('a8n_notify', {
      attributes: {
        'provider.id': c.req.param('providerId'),
        'notification.type': 'email_notification',
        'http.method': c.req.method,
        'http.url': c.req.url,
      },
    });

    try {
      if (!c.req.header('Authorization')) {
        span.setAttributes({ 'auth.status': 'missing' });
        return c.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const providerId = c.req.param('providerId');
      if (providerId === EProviders.google) {
        const body = await c.req.json<{ historyId: string }>();
        const subHeader = c.req.header('x-goog-pubsub-subscription-name');

        span.setAttributes({
          'history.id': body.historyId,
          'subscription.name': subHeader || 'missing',
        });

        if (!subHeader) {
          console.log('[GOOGLE] no subscription header', body);
          span.setAttributes({ 'error.type': 'missing_subscription_header' });
          return c.json({}, { status: 200 });
        }

        let isValid = false;
        try {
          isValid = await verifyToken(c.req.header('Authorization')!.split(' ')[1]);
        } catch (error) {
          console.log('[GOOGLE] token verification failed', error);
        }
        if (!isValid) {
          console.log('[GOOGLE] invalid request', body);
          span.setAttributes({ 'auth.status': 'invalid' });
          return c.json({}, { status: 200 });
        }

        span.setAttributes({ 'auth.status': 'valid' });

        try {
          await env.thread_queue.send({
            providerId,
            historyId: body.historyId,
            subscriptionName: subHeader,
          });
          span.setAttributes({ 'queue.message_sent': true });
          console.log('[A8N] Message sent to thread_queue', { providerId, historyId: body.historyId, subscriptionName: subHeader });
        } catch (error) {
          console.error('Error sending to thread queue', error, {
            providerId,
            historyId: body.historyId,
            subscriptionName: subHeader,
          });
          span.recordException(error as Error);
          span.setStatus({ code: 2, message: (error as Error).message });
        }
        return c.json({ message: 'OK' }, { status: 200 });
      }

      return c.json({ message: 'OK' }, { status: 200 });
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: 2, message: (error as Error).message });
      throw error;
    } finally {
      span.end();
    }
  })
  // OAuth discovery metadata
  .get('/.well-known/oauth-authorization-server', async (c) => {
    const auth = createAuth();
    return oAuthDiscoveryMetadata(auth)(c.req.raw);
  })
  .mount(
    '/sse',
    async (request, env, ctx) => {
      const authBearer = request.headers.get('Authorization');
      if (!authBearer) {
        return new Response('Unauthorized', { status: 401 });
      }
      const auth = createAuth();
      const session = await auth.api.getMcpSession({ headers: request.headers });
      if (!session) {
        return new Response('Unauthorized', { status: 401 });
      }
      ctx.props = {
        userId: session?.userId,
      };
      return ZeroMCP.serveSSE('/sse', { binding: 'ZERO_MCP' }).fetch(request, env, ctx);
    },
    { replaceRequest: false },
  )
  .mount(
    '/mcp/thinking/sse',
    async (request, env, ctx) => {
      return ThinkingMCP.serveSSE('/mcp/thinking/sse', { binding: 'THINKING_MCP' }).fetch(
        request,
        env,
        ctx,
      );
    },
    { replaceRequest: false },
  )
  .mount(
    '/mcp',
    async (request, env, ctx) => {
      const authBearer = request.headers.get('Authorization');
      if (!authBearer) {
        return new Response('Unauthorized', { status: 401 });
      }
      const auth = createAuth();
      const session = await auth.api.getMcpSession({ headers: request.headers });
      if (!session) {
        return new Response('Unauthorized', { status: 401 });
      }
      ctx.props = {
        userId: session?.userId,
      };
      return ZeroMCP.serve('/mcp', { binding: 'ZERO_MCP' }).fetch(request, env, ctx);
    },
    { replaceRequest: false },
  )
  .route('/api', api)
  .use(
    '*',
    agentsMiddleware({
      options: {
        onBeforeConnect: (c) => {
          if (!c.headers.get('Cookie')) {
            return new Response('Unauthorized', { status: 401 });
          }
        },
      },
    }),
  );

export default app;

export {
  ZeroAgent,
  ZeroMCP,
  ZeroDB,
  ZeroDriver,
  ThinkingMCP,
  WorkflowRunner,
  ThreadSyncWorker,
  SyncThreadsWorkflow,
  SyncThreadsCoordinatorWorkflow,
  ShardRegistry,
};

import {
  createUpdatedMatrixFromNewEmail,
  initializeStyleMatrixFromEmail,
  type EmailMatrix,
  type WritingStyleMatrix,
} from './services/writing-style-service';
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
} from './db/schema';
import {
  toAttachmentFiles,
  type SerializedAttachment,
  type AttachmentFile,
} from './lib/attachments';
import { SyncThreadsCoordinatorWorkflow } from './workflows/sync-threads-coordinator-workflow';
import { WorkerEntrypoint, DurableObject, RpcTarget } from 'cloudflare:workers';
// import { instrument, type ResolveConfigFn } from '@microlabs/otel-cf-workers';
import { getZeroAgent, getZeroDB, verifyToken } from './lib/server-utils';
import { SyncThreadsWorkflow } from './workflows/sync-threads-workflow';
import { ShardRegistry, ZeroAgent, ZeroDriver } from './routes/agent';
import { ThreadSyncWorker } from './routes/agent/sync-worker';
import { oAuthDiscoveryMetadata } from 'better-auth/plugins';
import { EProviders, type IEmailSendBatch } from './types';
import { eq, and, desc, asc, inArray } from 'drizzle-orm';
import { ThinkingMCP } from './lib/sequential-thinking';

import { contextStorage } from 'hono/context-storage';
import { defaultUserSettings } from './lib/schemas';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { enableBrainFunction } from './lib/brain';
import { trpcServer } from '@hono/trpc-server';
import { agentsMiddleware } from 'hono-agents';
import { ZeroMCP } from './routes/agent/mcp';
import { publicRouter } from './routes/auth';
import { WorkflowRunner } from './pipelines';
import { razorpayApi } from './routes/razorpay';
import { initTracing } from './lib/tracing';
import { env, type ZeroEnv } from './env';
import type { HonoContext } from './ctx';
import { createDb, type DB } from './db';
import { createAuth } from './lib/auth';
import { aiRouter } from './routes/ai';
import { appRouter } from './trpc';
import { cors } from 'hono/cors';
import { Effect } from 'effect';
import { Hono } from 'hono';
import { imapRouter } from './routes/imap';
import PostalMime from 'postal-mime';

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

  // Subscription management methods
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

  // Kanban Board Methods
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

  // Expose raw db for complex queries that don't have dedicated methods
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
    return await this.db.query.connection.findMany({
      where: eq(connection.userId, userId),
    });
  }

  // Kanban Board Methods
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
    // Remove from other columns first
    await this.db.delete(kanbanEmailMapping).where(
      and(
        eq(kanbanEmailMapping.threadId, threadId),
        eq(kanbanEmailMapping.connectionId, connectionId),
      ),
    );

    // Add to new column
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
    return await this.db
      .insert(connection)
      .values({
        ...updatingInfo,
        providerId,
        id: crypto.randomUUID(),
        email,
        userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [connection.email, connection.userId],
        set: {
          ...updatingInfo,
          updatedAt: new Date(),
        },
      })
      .returning({ id: connection.id });
  }

  /**
   * @param connectionId Dangerous, use findUserConnection instead
   * @returns
   */
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

  // Subscription management methods
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

  // Simple but effective hash for IP addresses
  // This preserves uniqueness while protecting PII
  const salt = 'zero-mail-ip-salt-2024'; // Consider using env variable for production
  let hash = 0;
  const str = ip + salt;

  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  // Return a prefixed hex representation
  return `ip_${Math.abs(hash).toString(16).padStart(8, '0')}`;
}

const api = new Hono<HonoContext>()
  .use(contextStorage())
  .use('*', async (c, next) => {
    // Initialize request tracing using headers (no context pollution)
    const traceId = c.req.header('X-Trace-ID') || crypto.randomUUID();
    const requestId = c.req.header('X-Request-Id') || crypto.randomUUID();

    // Set trace ID in response headers for client correlation
    c.header('X-Trace-ID', traceId);
    c.header('X-Request-ID', requestId);

    // Store trace ID in context variables for TRPC access
    c.set('traceId', traceId);
    c.set('requestId', requestId);

    const { TraceContext } = await import('./lib/trace-context');

    // Create trace for this request
    const rawIp = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For');
    const trace = TraceContext.createTrace(traceId, {
      requestId,
      ip: hashIpAddress(rawIp), // Hash IP address to protect PII
      userAgent: c.req.header('User-Agent'),
    });

    // Start authentication span
    const authSpan = TraceContext.startSpan(traceId, 'authentication', {
      method: c.req.method,
      url: c.req.url,
      hasAuthHeader: !!c.req.header('Authorization'),
    }, {
      'auth.method': c.req.header('Authorization') ? 'bearer_token' : 'session_cookie'
    });

    const auth = createAuth();
    c.set('auth', auth);

    // Inject DB into context
    try {
      console.log('[DB_MIDDLEWARE] Starting DB injection');
      console.log('[DB_MIDDLEWARE] HYPERDRIVE exists?', !!c.env.HYPERDRIVE);
      console.log('[DB_MIDDLEWARE] connectionString exists?', !!c.env.HYPERDRIVE?.connectionString);

      if (c.env.HYPERDRIVE?.connectionString) {
        const result = createDb(c.env.HYPERDRIVE.connectionString);
        const db = result.db;

        console.log('[DB_MIDDLEWARE] Created db, type:', typeof db);
        console.log('[DB_MIDDLEWARE] Created db, constructor:', db?.constructor?.name);
        console.log('[DB_MIDDLEWARE] db has select method?', typeof db?.select === 'function');
        console.log('[DB_MIDDLEWARE] db has query property?', !!db?.query);

        // Validate that db is a proper Drizzle instance
        if (!db || typeof db.select !== 'function') {
          throw new Error('createDb returned invalid database instance - missing select method');
        }

        c.set('db', db);
        console.log('[DB_MIDDLEWARE] Set c.var.db successfully');
      } else {
        console.error('[DB_MIDDLEWARE] HYPERDRIVE connection string missing - db will be undefined');
        // Set db to null explicitly to avoid undefined behavior
        c.set('db', null as any);
      }
    } catch (e) {
      console.error('[DB_MIDDLEWARE] Failed to create DB connection:', e);
      // Set db to null on error
      c.set('db', null as any);
    }

    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    c.set('sessionUser', session?.user);

    if (c.req.header('Authorization') && !session?.user) {
      // Start token verification span
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

    // Complete auth span
    TraceContext.completeSpan(traceId, authSpan.id, {
      authenticated: !!c.var.sessionUser,
      userId: c.var.sessionUser?.id,
      authMethod: session?.user ? 'session' : (c.req.header('Authorization') ? 'token' : 'none'),
    });

    // Update trace metadata with user info
    trace.metadata.userId = c.var.sessionUser?.id;
    trace.metadata.sessionId = c.var.sessionUser?.id || 'anonymous';

    // Start request processing span
    const requestSpan = TraceContext.startSpan(traceId, 'request_processing', {
      authenticated: !!c.var.sessionUser,
      path: new URL(c.req.url).pathname,
    });

    try {
      await next();
      // Don't complete the request span here - let TRPC middleware handle it
    } catch (error) {
      TraceContext.completeSpan(traceId, requestSpan.id, {
        success: false,

        statusCode: c.res.status,
      }, error instanceof Error ? error.message : 'Unknown request error');
      throw error;
    }
    // Note: Trace will be completed by TRPC middleware after logging

    c.set('sessionUser', undefined);
    c.set('auth', undefined as any);
  })
  .route('/ai', aiRouter)
  .route('/connections/imap', imapRouter)
  .route('/razorpay', razorpayApi)
  .route('/public', publicRouter)
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
        console.log('[TRPC] createContext - c.var.db type:', typeof c.var['db']);
        console.log('[TRPC] createContext - c.var.db is undefined?', c.var['db'] === undefined);
        console.log('[TRPC] createContext - c.var.db constructor:', c.var['db']?.constructor?.name);
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
      origin: (origin) => {
        if (!origin) return null;

        // Explicitly allow localhost:3000 for development
        if (origin === 'http://localhost:3000') return origin;

        let hostname: string;
        try {
          hostname = new URL(origin).hostname;
        } catch {
          return null;
        }
        const cookieDomain = env.COOKIE_DOMAIN;
        if (!cookieDomain) return null;
        // Strip leading dot from cookie domain for comparison
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
  .get('.well-known/oauth-authorization-server', async (c) => {
    const auth = createAuth();
    return oAuthDiscoveryMetadata(auth)(c.req.raw);
  })
  .mount(
    '/sse',
    async (request, env, ctx) => {
      const authBearer = request.headers.get('Authorization');
      if (!authBearer) {
        console.log('No auth provided');
        return new Response('Unauthorized', { status: 401 });
      }
      const auth = createAuth();
      const session = await auth.api.getMcpSession({ headers: request.headers });
      if (!session) {
        console.log('Invalid auth provided', Array.from(request.headers.entries()));
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
        console.log('Invalid auth provided', Array.from(request.headers.entries()));
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
  )
  .get('/health', (c) => c.json({ message: 'Zero Server is Up!' }))
  .get('/', (c) => c.redirect(`${env.VITE_PUBLIC_APP_URL}`))
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
  .get('/recordings/:r2Key', async (c) => {
    try {
      const r2Key = c.req.param('r2Key');

      // Get the recording from R2
      const object = await c.env.RECORDINGS_BUCKET.get(r2Key);

      if (!object) {
        return c.json({ error: 'Recording not found' }, { status: 404 });
      }

      // Stream the recording
      const headers = new Headers();
      headers.set('Content-Type', object.httpMetadata?.contentType || 'video/mp4');
      headers.set('Content-Length', object.size.toString());
      headers.set('Cache-Control', 'public, max-age=31536000');

      return new Response(object.body, {
        headers,
      });
    } catch (e) {
      console.error('error serving recording', e);
      return c.json({ error: 'error serving recording' }, { status: 500 });
    }
  })
  .post('/webhooks/livekit/egress', async (c) => {
    try {
      // Handle LiveKit egress webhook for recording completion
      const body = await c.req.json<{
        event: string;
        egressId: string;
        roomName: string;
        file?: {
          filename: string;
          size: number;
          duration: number;
        };
      }>();

      if (body.event === 'egress_ended' && body.file) {
        // Store the recording file to R2 if you're receiving it
        // This is a placeholder - actual implementation depends on your LiveKit setup
        console.log('Egress completed:', body);
      }

      return c.json({ success: true });
    } catch (e) {
      console.error('error handling egress webhook', e);
      return c.json({ error: 'error handling webhook' }, { status: 500 });
    }
  })
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
      if (env.DISABLE_WORKFLOWS === 'true') {
        span.setAttributes({ 'workflows.disabled': true });
        return c.json({ message: 'OK' }, { status: 200 });
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
        const isValid = await verifyToken(c.req.header('Authorization')!.split(' ')[1]);
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
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: 2, message: (error as Error).message });
      throw error;
    } finally {
      span.end();
    }
  });
const handler = {
  async fetch(request: Request, env: ZeroEnv, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },
};

// const config: ResolveConfigFn = (env: ZeroEnv) => {
//   return {
//     exporter: {
//       url: env.OTEL_EXPORTER_OTLP_ENDPOINT || 'https://api.axiom.co/v1/traces',
//       headers: env.OTEL_EXPORTER_OTLP_HEADERS
//         ? Object.fromEntries(
//             env.OTEL_EXPORTER_OTLP_HEADERS.split(',').map((header: string) => {
//               const [key, value] = header.split('=');
//               return [key.trim(), value.trim()];
//             }),
//           )
//         : {},
//     },
//     service: {
//       name: env.OTEL_SERVICE_NAME || 'zero-email-server',
//       version: '1.0.0',
//     },
//   };
// };

export default class Entry extends WorkerEntrypoint<ZeroEnv> {
  async fetch(request: Request): Promise<Response> {
    return handler.fetch(request, this.env, this.ctx);
  }
  async queue(
    batch: MessageBatch<unknown> | { queue: string; messages: Array<{ body: IEmailSendBatch }> },
  ) {
    switch (true) {
      case batch.queue.startsWith('subscribe-queue'): {
        console.log('batch', batch);
        await Promise.all(
          batch.messages.map(async (msg: any) => {
            const connectionId = msg.body.connectionId;
            const providerId = msg.body.providerId;
            try {
              await enableBrainFunction({ id: connectionId, providerId });
            } catch (error) {
              console.error(
                `Failed to enable brain function for connection ${connectionId}:`,
                error,
              );
            }
          }),
        );
        console.log('[SUBSCRIBE_QUEUE] batch done');
        return;
      }
      case batch.queue.startsWith('send-email-queue'): {
        await Promise.all(
          batch.messages.map(async (msg: any) => {
            const { messageId, connectionId, mail } = msg.body;

            const { pending_emails_status: statusKV, pending_emails_payload: payloadKV } = this
              .env as { pending_emails_status: KVNamespace; pending_emails_payload: KVNamespace };

            const status = await statusKV.get(messageId);
            if (status === 'cancelled') {
              console.log(`Email ${messageId} cancelled – skipping send.`);
              return;
            }

            let payload = mail;
            if (!payload) {
              const stored = await payloadKV.get(messageId);
              if (!stored) {
                console.error(`No payload found for scheduled email ${messageId}`);
                return;
              }
              payload = JSON.parse(stored);
            }

            const agent = await getZeroAgent(connectionId, this.ctx);
            try {
              if (Array.isArray((payload as any).attachments)) {
                const attachments = (payload as any).attachments;

                const processedAttachments = await Promise.all(
                  attachments.map(
                    async (att: SerializedAttachment | AttachmentFile, index: number) => {
                      if ('arrayBuffer' in att && typeof att.arrayBuffer === 'function') {
                        return { attachment: att as AttachmentFile, index };
                      } else {
                        const processed = toAttachmentFiles([att as SerializedAttachment]);
                        return { attachment: processed[0], index };
                      }
                    },
                  ),
                );

                const orderedAttachments = Array.from({ length: attachments.length });
                processedAttachments.forEach(({ attachment, index }) => {
                  orderedAttachments[index] = attachment;
                });

                (payload as any).attachments = orderedAttachments;
              }

              if ('draftId' in (payload as any) && (payload as any).draftId) {
                const { draftId, ...rest } = payload as any;
                await agent.stub.sendDraft(draftId, rest as any);
              } else {
                await agent.stub.create(payload as any);
              }

              await statusKV.delete(messageId);
              await payloadKV.delete(messageId);
              console.log(`Email ${messageId} sent successfully`);
            } catch (error) {
              console.error(`Failed to send scheduled email ${messageId}:`, error);
              await statusKV.delete(messageId);
              await payloadKV.delete(messageId);
            }
          }),
        );
        return;
      }
      case batch.queue.startsWith('thread-queue'): {
        const tracer = initTracing();

        await Promise.all(
          batch.messages.map(async (msg: any) => {
            const span = tracer.startSpan('thread_queue_processing', {
              attributes: {
                'provider.id': msg.body.providerId,
                'history.id': msg.body.historyId,
                'subscription.name': msg.body.subscriptionName,
                'queue.name': batch.queue,
              },
            });

            try {
              const providerId = msg.body.providerId;
              const historyId = msg.body.historyId;
              const subscriptionName = msg.body.subscriptionName;

              const workflowRunner = env.WORKFLOW_RUNNER.get(env.WORKFLOW_RUNNER.newUniqueId());
              const result = await workflowRunner.runMainWorkflow({
                providerId,
                historyId,
                subscriptionName,
              });
              console.log('[THREAD_QUEUE] result', result);
              span.setAttributes({
                'workflow.result': typeof result === 'string' ? result : JSON.stringify(result),
                'workflow.success': true,
              });
            } catch (error) {
              console.error('Error running workflow', error);
              span.recordException(error as Error);
              span.setStatus({ code: 2, message: (error as Error).message });
            } finally {
              span.end();
            }
          }),
        );
        break;
      }
    }
  }
  async scheduled() {
    console.log('Running scheduled tasks...');

    await this.processScheduledEmails();

    await this.processExpiredSubscriptions();
  }

  async email(message: ForwardableEmailMessage, env: ZeroEnv, _ctx: ExecutionContext) {
    console.log(`[EMAIL] Received email from ${message.from} to ${message.to}`);

    try {
      // 1. Parse Email
      const parser = new PostalMime();
      const rawEmail = await new Response(message.raw).arrayBuffer();
      const parsed = await parser.parse(rawEmail);

      // 2. Store Raw in R2
      const messageId = message.headers.get('Message-ID') || crypto.randomUUID();
      const r2Key = `email/${messageId}`;
      await env.THREADS_BUCKET.put(r2Key, rawEmail);

      // 3. Find Connection
      const { db, conn } = createDb(env.HYPERDRIVE.connectionString);
      const recipient = message.to;

      // Find connection where email matches recipient
      const foundConnection = await db.query.connection.findFirst({
        where: eq(connection.email, recipient),
      });

      if (!foundConnection) {
        console.log(`[EMAIL] No connection found for recipient ${recipient}`);
        await conn.end();
        // We don't reject because that would bounce. We just ignore for now.
        return;
      }

      // 4. Determine Thread ID
      let threadId = crypto.randomUUID();
      const inReplyTo = parsed.inReplyTo;

      if (inReplyTo) {
        // Try to find parent message
        // Note: inReplyTo from postal-mime might be a string or array? Usually string.
        // We need to check schema for email table.
        const parent = await db.query.email.findFirst({
          where: eq(email.messageId, inReplyTo),
        });
        if (parent) {
          threadId = parent.threadId;
        }
      }

      // 5. Insert into DB
      await db.insert(email).values({
        id: crypto.randomUUID(),
        threadId,
        connectionId: foundConnection.id,
        messageId: parsed.messageId || messageId,
        inReplyTo: parsed.inReplyTo,
        references: typeof parsed.references === 'string' ? parsed.references : (Array.isArray(parsed.references) ? parsed.references.join(' ') : null),
        subject: parsed.subject || '(No Subject)',
        from: parsed.from ? { name: parsed.from.name, address: parsed.from.address } : { name: '', address: message.from },
        to: parsed.to?.map(t => ({ name: t.name, address: t.address })) || [],
        cc: parsed.cc?.map(t => ({ name: t.name, address: t.address })) || [],
        bcc: parsed.bcc?.map(t => ({ name: t.name, address: t.address })) || [],
        bodyR2Key: r2Key,
        internalDate: new Date(parsed.date || Date.now()),
        snippet: parsed.text?.substring(0, 200) || '',
        isRead: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        // labels: [], // Default labels?
      });

      await conn.end();
      console.log(`[EMAIL] Processed email ${messageId} for connection ${foundConnection.id}`);

    } catch (error) {
      console.error('[EMAIL] Error processing email:', error);
    }
  }

  private async processScheduledEmails() {
    console.log('Checking for scheduled emails ready to be queued...');
    const { scheduled_emails: scheduledKV, send_email_queue } = this.env as {
      scheduled_emails: KVNamespace;
      send_email_queue: Queue<IEmailSendBatch>;
    };

    try {
      const now = Date.now();
      const twelveHoursFromNow = now + 12 * 60 * 60 * 1000;

      let cursor: string | undefined = undefined;
      const batchSize = 1000;

      do {
        const listResp: {
          keys: { name: string }[];
          cursor?: string;
        } = await scheduledKV.list({ cursor, limit: batchSize });
        cursor = listResp.cursor;

        for (const key of listResp.keys) {
          try {
            const scheduledData = await scheduledKV.get(key.name);
            if (!scheduledData) continue;

            const { messageId, connectionId, sendAt } = JSON.parse(scheduledData);

            if (sendAt <= twelveHoursFromNow) {
              const delaySeconds = Math.max(0, Math.floor((sendAt - now) / 1000));

              console.log(`Queueing scheduled email ${messageId} with ${delaySeconds}s delay`);

              const queueBody: IEmailSendBatch = {
                messageId,
                connectionId,
                sendAt,
              };

              await send_email_queue.send(queueBody, { delaySeconds });
              await scheduledKV.delete(key.name);

              console.log(`Successfully queued scheduled email ${messageId}`);
            }
          } catch (error) {
            console.error('Failed to process scheduled email key', key.name, error);
          }
        }
      } while (cursor);
    } catch (error) {
      console.error('Error processing scheduled emails:', error);
    }
  }

  private async processExpiredSubscriptions() {
    console.log('[SCHEDULED] Checking for expired subscriptions...');
    const { db, conn } = createDb(this.env.HYPERDRIVE.connectionString);
    const allAccounts = await db.query.connection.findMany({
      where: (fields, { isNotNull, and }) =>
        and(isNotNull(fields.accessToken), isNotNull(fields.refreshToken)),
    });
    await conn.end();
    console.log('[SCHEDULED] allAccounts', allAccounts.length);
    const now = new Date();
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

    const expiredSubscriptions: Array<{ connectionId: string; providerId: EProviders }> = [];

    const nowTs = Date.now();

    const unsnoozeMap: Record<string, { threadIds: string[]; keyNames: string[] }> = {};

    let cursor: string | undefined = undefined;
    do {
      const listResp: {
        keys: { name: string; metadata?: { wakeAt?: string } }[];
        cursor?: string;
      } = await this.env.snoozed_emails.list({ cursor, limit: 1000 });
      cursor = listResp.cursor;

      for (const key of listResp.keys) {
        try {
          const wakeAtIso = key.metadata?.wakeAt as string | undefined;
          if (!wakeAtIso) continue;
          const wakeAt = new Date(wakeAtIso).getTime();
          if (wakeAt > nowTs) continue;

          const [threadId, connectionId] = key.name.split('__');
          if (!threadId || !connectionId) continue;

          if (!unsnoozeMap[connectionId]) {
            unsnoozeMap[connectionId] = { threadIds: [], keyNames: [] };
          }
          unsnoozeMap[connectionId].threadIds.push(threadId);
          unsnoozeMap[connectionId].keyNames.push(key.name);
        } catch (error) {
          console.error('Failed to prepare unsnooze for key', key.name, error);
        }
      }
    } while (cursor);

    // await Promise.all(
    //   Object.entries(unsnoozeMap).map(async ([connectionId, { threadIds, keyNames }]) => {
    //     try {
    //       const { stub: agent } = await getZeroAgent(connectionId, this.ctx);
    //       await agent.queue('unsnoozeThreadsHandler', { connectionId, threadIds, keyNames });
    //     } catch (error) {
    //       console.error('Failed to enqueue unsnooze tasks', { connectionId, threadIds, error });
    //     }
    //   }),
    // );

    await Promise.all(
      allAccounts.map(async ({ id, providerId }) => {
        const lastSubscribed = await this.env.gmail_sub_age.get(`${id}__${providerId}`);

        if (lastSubscribed) {
          const subscriptionDate = new Date(lastSubscribed);
          if (subscriptionDate < fiveDaysAgo) {
            console.log(`[SCHEDULED] Found expired Google subscription for connection: ${id}`);
            expiredSubscriptions.push({ connectionId: id, providerId: providerId as EProviders });
          }
        } else {
          expiredSubscriptions.push({ connectionId: id, providerId: providerId as EProviders });
        }
      }),
    );

    // Send expired subscriptions to queue for renewal
    if (expiredSubscriptions.length > 0) {
      console.log(
        `[SCHEDULED] Sending ${expiredSubscriptions.length} expired subscriptions to renewal queue`,
      );
      await Promise.all(
        expiredSubscriptions.map(async ({ connectionId, providerId }) => {
          await this.env.subscribe_queue.send({ connectionId, providerId });
        }),
      );
    }

    console.log(
      `[SCHEDULED] Processed ${allAccounts.keys.length} accounts, found ${expiredSubscriptions.length} expired subscriptions`,
    );
  }
}

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

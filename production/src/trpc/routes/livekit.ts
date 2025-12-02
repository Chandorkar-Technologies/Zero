import { privateProcedure, publicProcedure, router } from '../trpc';
import { livekitMeeting, livekitParticipant } from '../../db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { z } from 'zod';
import { env } from '../../env';
import { TRPCError } from '@trpc/server';
import { AccessToken } from 'livekit-server-sdk';

export const livekitRouter = router({
  // Create a new meeting
  create: privateProcedure
    .input(
      z.object({
        title: z.string(),
        description: z.string().optional(),
        scheduledFor: z.date().optional(),
        maxParticipants: z.number().default(50),
        recordingEnabled: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { sessionUser } = ctx;
      const meetingId = crypto.randomUUID();
      const roomName = `meeting-${meetingId}`;

      // Create meeting record in database
      await ctx.db.insert(livekitMeeting).values({
        id: meetingId,
        roomName,
        title: input.title,
        description: input.description,
        hostId: sessionUser.id,
        scheduledFor: input.scheduledFor,
        status: input.scheduledFor && input.scheduledFor > new Date() ? 'scheduled' : 'active',
        maxParticipants: input.maxParticipants,
        recordingEnabled: input.recordingEnabled,
        startedAt: input.scheduledFor ? null : new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      return {
        meetingId,
        roomName,
        joinUrl: `${env.VITE_PUBLIC_APP_URL}/meet/${meetingId}`,
      };
    }),

  // Get meeting details
  get: publicProcedure
    .input(
      z.object({
        meetingId: z.string(),
      }),
    )
    .query(async ({ input }) => {
      // Manually get DB instance - use HYPERDRIVE for Cloudflare Workers
      const { createDb } = await import('../../db');
      const { db } = createDb(env.HYPERDRIVE.connectionString);

      const meetings = await db
        .select()
        .from(livekitMeeting)
        .where(eq(livekitMeeting.id, input.meetingId))
        .limit(1);

      const meetingRecord = meetings[0];

      if (!meetingRecord) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Meeting not found' });
      }

      // Get participants
      const participants = await db
        .select()
        .from(livekitParticipant)
        .where(eq(livekitParticipant.meetingId, input.meetingId));

      return {
        ...meetingRecord,
        participants,
      };
    }),

  // List user's meetings
  list: privateProcedure
    .input(
      z.object({
        status: z.enum(['scheduled', 'active', 'ended']).optional(),
        limit: z.number().default(50),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { sessionUser } = ctx;

      let query = ctx.db
        .select()
        .from(livekitMeeting)
        .where(eq(livekitMeeting.hostId, sessionUser.id))
        .orderBy(desc(livekitMeeting.createdAt))
        .limit(input.limit);

      if (input.status) {
        query = ctx.db
          .select()
          .from(livekitMeeting)
          .where(and(eq(livekitMeeting.hostId, sessionUser.id), eq(livekitMeeting.status, input.status)))
          .orderBy(desc(livekitMeeting.createdAt))
          .limit(input.limit);
      }

      const meetings = await query;

      return meetings;
    }),

  // Generate LiveKit access token to join a meeting
  getToken: privateProcedure
    .input(
      z.object({
        meetingId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { sessionUser } = ctx;

      // Find meeting
      const meetingRecord = await ctx.db.query.livekitMeeting.findFirst({
        where: eq(livekitMeeting.id, input.meetingId),
      });

      if (!meetingRecord) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Meeting not found' });
      }

      if (meetingRecord.status === 'ended' || meetingRecord.status === 'cancelled') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Meeting has ended' });
      }

      // Update meeting status to active if it was scheduled
      if (meetingRecord.status === 'scheduled') {
        await ctx.db
          .update(livekitMeeting)
          .set({
            status: 'active',
            startedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(livekitMeeting.id, input.meetingId));
      }

      const participantId = crypto.randomUUID();
      const identity = `user-${sessionUser.id}`;

      // Record participant
      await ctx.db.insert(livekitParticipant).values({
        id: participantId,
        meetingId: input.meetingId,
        userId: sessionUser.id,
        identity,
        name: sessionUser.name || sessionUser.email,
        joinedAt: new Date(),
        createdAt: new Date(),
      });

      // Generate LiveKit access token
      const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
        identity,
        name: sessionUser.name || sessionUser.email,
      });

      // Grant permissions
      at.addGrant({
        room: meetingRecord.roomName,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      });

      const token = await at.toJwt();

      return {
        token,
        roomName: meetingRecord.roomName,
        identity,
        wsUrl: env.LIVEKIT_WS_URL,
      };
    }),

  // Generate guest token (no auth required)
  getGuestToken: publicProcedure
    .input(
      z.object({
        meetingId: z.string(),
        name: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      // Manually get DB instance - use HYPERDRIVE for Cloudflare Workers
      const { createDb } = await import('../../db');
      const { db } = createDb(env.HYPERDRIVE.connectionString);

      const meetingRecord = await db.query.livekitMeeting.findFirst({
        where: eq(livekitMeeting.id, input.meetingId),
      });

      if (!meetingRecord) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Meeting not found' });
      }

      if (meetingRecord.status === 'ended' || meetingRecord.status === 'cancelled') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Meeting has ended' });
      }

      const participantId = crypto.randomUUID();
      const identity = `guest-${participantId}`;

      // Record guest participant
      await db.insert(livekitParticipant).values({
        id: participantId,
        meetingId: input.meetingId,
        userId: null,
        identity,
        name: input.name,
        joinedAt: new Date(),
        createdAt: new Date(),
      });

      // Generate LiveKit access token
      const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
        identity,
        name: input.name,
      });

      at.addGrant({
        room: meetingRecord.roomName,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      });

      const token = await at.toJwt();

      return {
        token,
        roomName: meetingRecord.roomName,
        identity,
        wsUrl: env.LIVEKIT_WS_URL,
      };
    }),

  // End a meeting
  end: privateProcedure
    .input(
      z.object({
        meetingId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { sessionUser } = ctx;

      const meetingRecord = await ctx.db.query.livekitMeeting.findFirst({
        where: eq(livekitMeeting.id, input.meetingId),
      });

      if (!meetingRecord) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Meeting not found' });
      }

      if (meetingRecord.hostId !== sessionUser.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only host can end meeting' });
      }

      // Calculate duration
      const startedAt = meetingRecord.startedAt || new Date();
      const duration = Math.floor((Date.now() - startedAt.getTime()) / 1000);

      // Update meeting status
      await ctx.db
        .update(livekitMeeting)
        .set({
          status: 'ended',
          endedAt: new Date(),
          duration,
          updatedAt: new Date(),
        })
        .where(eq(livekitMeeting.id, input.meetingId));

      return { success: true };
    }),

});

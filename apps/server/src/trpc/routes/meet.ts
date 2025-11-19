import { privateProcedure, router } from '../trpc';
import { meeting, meetingParticipant, meetingRecording, meetingMessage } from '../../db/schema';
import { getContext } from 'hono/context-storage';
import type { HonoContext } from '../../ctx';
import { eq, desc, and } from 'drizzle-orm';
import { z } from 'zod';
import { env } from '../../env';
import { TRPCError } from '@trpc/server';

export const meetRouter = router({
  create: privateProcedure
    .input(
      z.object({
        title: z.string(),
        description: z.string().optional(),
        scheduledFor: z.date().optional(),
        maxParticipants: z.number().default(50),
        requiresAuth: z.boolean().default(true),
        allowChat: z.boolean().default(true),
        allowScreenShare: z.boolean().default(true),
        allowFileShare: z.boolean().default(true),
        isRecording: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { sessionUser } = ctx;
      const meetingId = crypto.randomUUID();
      const roomId = crypto.randomUUID(); // Unique room ID for Durable Object

      // Create meeting record in database
      await ctx.db.insert(meeting).values({
        id: meetingId,
        title: input.title,
        description: input.description,
        hostId: sessionUser.id,
        roomId,
        scheduledFor: input.scheduledFor,
        status: input.scheduledFor && input.scheduledFor > new Date() ? 'scheduled' : 'active',
        isRecording: input.isRecording,
        maxParticipants: input.maxParticipants,
        requiresAuth: input.requiresAuth,
        allowChat: input.allowChat,
        allowScreenShare: input.allowScreenShare,
        allowFileShare: input.allowFileShare,
        startedAt: input.scheduledFor ? null : new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Initialize MeetingRoom Durable Object
      const c = getContext<HonoContext>();
      const durableObjectId = c.env.MEETING_ROOM.idFromName(roomId);
      const stub = c.env.MEETING_ROOM.get(durableObjectId);

      await stub.fetch('https://meeting-room/init', {
        method: 'POST',
        body: JSON.stringify({
          id: roomId,
          hostId: sessionUser.id,
          settings: {
            maxParticipants: input.maxParticipants,
            allowChat: input.allowChat,
            allowScreenShare: input.allowScreenShare,
            allowFileShare: input.allowFileShare,
          },
        }),
      });

      return {
        meetingId,
        roomId,
        joinUrl: `${env.VITE_PUBLIC_APP_URL}/meet/${roomId}`,
      };
    }),

  get: privateProcedure
    .input(
      z.object({
        meetingId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const meetings = await ctx.db
        .select()
        .from(meeting)
        .where(eq(meeting.id, input.meetingId))
        .limit(1);

      const meetingRecord = meetings[0];

      if (!meetingRecord) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Meeting not found' });
      }

      // Get participants
      const participants = await ctx.db
        .select()
        .from(meetingParticipant)
        .where(eq(meetingParticipant.meetingId, input.meetingId));

      return {
        ...meetingRecord,
        participants,
      };
    }),

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
        .from(meeting)
        .where(eq(meeting.hostId, sessionUser.id))
        .orderBy(desc(meeting.createdAt))
        .limit(input.limit);

      if (input.status) {
        query = ctx.db
          .select()
          .from(meeting)
          .where(and(eq(meeting.hostId, sessionUser.id), eq(meeting.status, input.status)))
          .orderBy(desc(meeting.createdAt))
          .limit(input.limit);
      }

      const meetings = await query;
      return meetings;
    }),

  join: privateProcedure
    .input(
      z.object({
        roomId: z.string(),
        name: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { sessionUser } = ctx;

      // Find meeting by roomId
      const meetingRecord = await ctx.db.query.meeting.findFirst({
        where: eq(meeting.roomId, input.roomId),
      });

      if (!meetingRecord) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Meeting not found' });
      }

      if (meetingRecord.status === 'ended') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Meeting has ended' });
      }

      // Update meeting status to active if it was scheduled
      if (meetingRecord.status === 'scheduled') {
        await ctx.db
          .update(meeting)
          .set({
            status: 'active',
            startedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(meeting.id, meetingRecord.id));
      }

      const participantId = crypto.randomUUID();

      // Add participant to database
      await ctx.db.insert(meetingParticipant).values({
        id: participantId,
        meetingId: meetingRecord.id,
        userId: sessionUser.id,
        guestName: input.name || sessionUser.name || sessionUser.email,
        guestEmail: sessionUser.email,
        joinedAt: new Date(),
        createdAt: new Date(),
      });

      // Build WebSocket URL with proper auth params
      const baseUrl = env.VITE_PUBLIC_BACKEND_URL.replace('https://', 'wss://').replace(
        'http://',
        'ws://',
      );
      const wsUrl = `${baseUrl}/meet/ws/${input.roomId}?participantId=${participantId}&userId=${sessionUser.id}&name=${encodeURIComponent(input.name || sessionUser.name || sessionUser.email)}&email=${encodeURIComponent(sessionUser.email)}`;

      return {
        participantId,
        wsUrl,
        meetingId: meetingRecord.id,
        roomId: input.roomId,
      };
    }),

  joinAsGuest: privateProcedure
    .input(
      z.object({
        roomId: z.string(),
        name: z.string(),
        email: z.string().email().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Find meeting by roomId
      const meetingRecord = await ctx.db.query.meeting.findFirst({
        where: eq(meeting.roomId, input.roomId),
      });

      if (!meetingRecord) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Meeting not found' });
      }

      if (meetingRecord.requiresAuth) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'This meeting requires authentication',
        });
      }

      if (meetingRecord.status === 'ended') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Meeting has ended' });
      }

      const participantId = crypto.randomUUID();

      // Add guest participant
      await ctx.db.insert(meetingParticipant).values({
        id: participantId,
        meetingId: meetingRecord.id,
        userId: null,
        guestName: input.name,
        guestEmail: input.email,
        joinedAt: new Date(),
        createdAt: new Date(),
      });

      const baseUrl = env.VITE_PUBLIC_BACKEND_URL.replace('https://', 'wss://').replace(
        'http://',
        'ws://',
      );
      const wsUrl = `${baseUrl}/meet/ws/${input.roomId}?participantId=${participantId}&name=${encodeURIComponent(input.name)}${input.email ? `&email=${encodeURIComponent(input.email)}` : ''}`;

      return {
        participantId,
        wsUrl,
        meetingId: meetingRecord.id,
        roomId: input.roomId,
      };
    }),

  end: privateProcedure
    .input(
      z.object({
        meetingId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { sessionUser } = ctx;
      const c = getContext<HonoContext>();

      const meetingRecord = await ctx.db.query.meeting.findFirst({
        where: eq(meeting.id, input.meetingId),
      });

      if (!meetingRecord) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Meeting not found' });
      }

      if (meetingRecord.hostId !== sessionUser.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only host can end meeting' });
      }

      // Calculate duration
      const startedAt = meetingRecord.startedAt || new Date();
      const duration = Math.floor((Date.now() - startedAt.getTime()) / 1000); // seconds

      // Update meeting status
      await ctx.db
        .update(meeting)
        .set({
          status: 'ended',
          endedAt: new Date(),
          duration,
          updatedAt: new Date(),
        })
        .where(eq(meeting.id, input.meetingId));

      // End the Durable Object meeting
      const durableObjectId = c.env.MEETING_ROOM.idFromName(meetingRecord.roomId);
      const stub = c.env.MEETING_ROOM.get(durableObjectId);

      await stub.fetch('https://meeting-room/end', {
        method: 'POST',
      });

      return { success: true };
    }),

  update: privateProcedure
    .input(
      z.object({
        meetingId: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        scheduledFor: z.date().optional(),
        maxParticipants: z.number().optional(),
        allowChat: z.boolean().optional(),
        allowScreenShare: z.boolean().optional(),
        allowFileShare: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { sessionUser } = ctx;
      const { meetingId, ...updates } = input;

      const meetingRecord = await ctx.db.query.meeting.findFirst({
        where: eq(meeting.id, meetingId),
      });

      if (!meetingRecord) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Meeting not found' });
      }

      if (meetingRecord.hostId !== sessionUser.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only host can update meeting' });
      }

      await ctx.db
        .update(meeting)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(meeting.id, meetingId));

      return { success: true };
    }),

  getRecordings: privateProcedure
    .input(
      z.object({
        meetingId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const recordings = await ctx.db.query.meetingRecording.findMany({
        where: eq(meetingRecording.meetingId, input.meetingId),
        orderBy: [desc(meetingRecording.createdAt)],
      });

      return recordings;
    }),

  getChatHistory: privateProcedure
    .input(
      z.object({
        meetingId: z.string(),
        limit: z.number().default(100),
      }),
    )
    .query(async ({ input, ctx }) => {
      const messages = await ctx.db.query.meetingMessage.findMany({
        where: eq(meetingMessage.meetingId, input.meetingId),
        orderBy: [desc(meetingMessage.createdAt)],
        limit: input.limit,
      });

      return messages.reverse(); // Return in chronological order
    }),

  uploadRecording: privateProcedure
    .input(
      z.object({
        meetingId: z.string(),
        duration: z.number(),
        fileSize: z.number(),
        r2Key: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { sessionUser } = ctx;

      const meetingRecord = await ctx.db.query.meeting.findFirst({
        where: eq(meeting.id, input.meetingId),
      });

      if (!meetingRecord) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Meeting not found' });
      }

      if (meetingRecord.hostId !== sessionUser.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only host can upload recordings' });
      }

      const recordingId = crypto.randomUUID();
      const recordingUrl = `https://recordings.nubo.email/${input.r2Key}`;

      // Save recording metadata
      await ctx.db.insert(meetingRecording).values({
        id: recordingId,
        meetingId: input.meetingId,
        r2Key: input.r2Key,
        fileName: `recording-${recordingId}.webm`,
        duration: input.duration,
        fileSize: input.fileSize,
        status: 'ready',
        startedAt: new Date(),
        endedAt: new Date(),
        createdAt: new Date(),
      });

      // Update meeting record
      await ctx.db
        .update(meeting)
        .set({
          recordingUrl,
          isRecording: false,
          updatedAt: new Date(),
        })
        .where(eq(meeting.id, input.meetingId));

      return { recordingId, url: recordingUrl };
    }),

  getRecordingUrl: privateProcedure
    .input(
      z.object({
        recordingId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const recording = await ctx.db.query.meetingRecording.findFirst({
        where: eq(meetingRecording.id, input.recordingId),
      });

      if (!recording) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Recording not found' });
      }

      return {
        url: `https://recordings.nubo.email/${recording.r2Key}`,
        duration: recording.duration,
        fileSize: recording.fileSize,
      };
    }),

  sendEmailInvitation: privateProcedure
    .input(
      z.object({
        meetingId: z.string(),
        emails: z.array(z.string().email()),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { sessionUser } = ctx;

      const meetingRecord = await ctx.db.query.meeting.findFirst({
        where: eq(meeting.id, input.meetingId),
      });

      if (!meetingRecord) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Meeting not found' });
      }

      if (meetingRecord.hostId !== sessionUser.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only host can send invitations' });
      }

      const joinUrl = `${env.VITE_PUBLIC_APP_URL}/meet/${meetingRecord.roomId}`;

      // Send emails (you would integrate with your email service here)
      // For now, just return the invitation details
      return {
        meetingTitle: meetingRecord.title,
        joinUrl,
        sentTo: input.emails,
        scheduledFor: meetingRecord.scheduledFor,
      };
    }),

  getAnalytics: privateProcedure
    .input(
      z.object({
        meetingId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { sessionUser } = ctx;

      const meetingRecord = await ctx.db.query.meeting.findFirst({
        where: eq(meeting.id, input.meetingId),
      });

      if (!meetingRecord) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Meeting not found' });
      }

      if (meetingRecord.hostId !== sessionUser.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only host can view analytics' });
      }

      // Get participants
      const participants = await ctx.db.query.meetingParticipant.findMany({
        where: eq(meetingParticipant.meetingId, input.meetingId),
      });

      // Get messages
      const messages = await ctx.db.query.meetingMessage.findMany({
        where: eq(meetingMessage.meetingId, input.meetingId),
      });

      // Get recordings
      const recordings = await ctx.db.query.meetingRecording.findMany({
        where: eq(meetingRecording.meetingId, input.meetingId),
      });

      // Calculate stats
      const totalParticipants = participants.length;
      const guestCount = participants.filter((p) => !p.userId).length;
      const authenticatedCount = totalParticipants - guestCount;
      const totalMessages = messages.length;
      const totalRecordings = recordings.length;

      // Calculate average session duration
      const participantDurations = participants.map((p) => {
        const joined = new Date(p.joinedAt).getTime();
        const left = p.leftAt ? new Date(p.leftAt).getTime() : Date.now();
        return (left - joined) / 1000 / 60; // minutes
      });

      const averageSessionDuration =
        participantDurations.length > 0
          ? participantDurations.reduce((a, b) => a + b, 0) / participantDurations.length
          : 0;

      return {
        meeting: {
          title: meetingRecord.title,
          status: meetingRecord.status,
          duration: meetingRecord.duration,
          startedAt: meetingRecord.startedAt,
          endedAt: meetingRecord.endedAt,
        },
        participants: {
          total: totalParticipants,
          authenticated: authenticatedCount,
          guests: guestCount,
          averageSessionDuration: Math.round(averageSessionDuration),
        },
        engagement: {
          totalMessages,
          messagesPerParticipant: totalParticipants > 0 ? totalMessages / totalParticipants : 0,
        },
        recordings: {
          total: totalRecordings,
          totalSize: recordings.reduce((acc, r) => acc + (r.fileSize || 0), 0),
        },
      };
    }),
});

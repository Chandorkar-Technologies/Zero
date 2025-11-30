import { privateProcedure, publicProcedure, router } from '../trpc';
import { livekitMeeting, livekitParticipant } from '../../db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { z } from 'zod';
import { env } from '../../env';
import { TRPCError } from '@trpc/server';
import { AccessToken } from 'livekit-server-sdk';
import { resend } from '../../lib/services';

// Generate ICS calendar content for meeting invite
function generateICS(
  meetingId: string,
  title: string,
  description: string | undefined,
  startDate: Date,
  hostName: string,
  hostEmail: string,
  joinUrl: string,
): string {
  const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // 1 hour duration default

  const formatDate = (date: Date) => {
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  };

  const uid = `${meetingId}@nubo.email`;
  const now = formatDate(new Date());
  const start = formatDate(startDate);
  const end = formatDate(endDate);

  const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Nubo//Nubo Meet//EN
CALSCALE:GREGORIAN
METHOD:REQUEST
BEGIN:VEVENT
UID:${uid}
DTSTAMP:${now}
DTSTART:${start}
DTEND:${end}
SUMMARY:${title}
DESCRIPTION:${description || `Join the meeting: ${joinUrl}`}
LOCATION:${joinUrl}
ORGANIZER;CN=${hostName}:mailto:${hostEmail}
URL:${joinUrl}
STATUS:CONFIRMED
SEQUENCE:0
END:VEVENT
END:VCALENDAR`;

  return icsContent;
}

// Send meeting invite email
async function sendMeetingInvite(
  inviteeEmail: string,
  meetingId: string,
  title: string,
  description: string | undefined,
  scheduledFor: Date,
  hostName: string,
  hostEmail: string,
  joinUrl: string,
): Promise<void> {
  const icsContent = generateICS(
    meetingId,
    title,
    description,
    scheduledFor,
    hostName,
    hostEmail,
    joinUrl,
  );

  const formattedDate = scheduledFor.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5;">
      <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <div style="background-color: #2563eb; padding: 24px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Meeting Invitation</h1>
        </div>
        <div style="padding: 24px;">
          <h2 style="margin: 0 0 16px; color: #1a1a1a;">${title}</h2>
          ${description ? `<p style="color: #666; margin: 0 0 16px;">${description}</p>` : ''}
          <div style="background-color: #f8fafc; border-radius: 6px; padding: 16px; margin-bottom: 24px;">
            <p style="margin: 0 0 8px; color: #374151;"><strong>When:</strong> ${formattedDate}</p>
            <p style="margin: 0 0 8px; color: #374151;"><strong>Host:</strong> ${hostName}</p>
          </div>
          <div style="text-align: center; margin-bottom: 24px;">
            <a href="${joinUrl}" style="display: inline-block; background-color: #2563eb; color: white; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-weight: 500;">Join Meeting</a>
          </div>
          <p style="color: #666; font-size: 14px; margin: 0;">
            Or copy this link: <a href="${joinUrl}" style="color: #2563eb;">${joinUrl}</a>
          </p>
        </div>
        <div style="background-color: #f8fafc; padding: 16px; text-align: center; border-top: 1px solid #e5e7eb;">
          <p style="margin: 0; color: #666; font-size: 12px;">
            This invitation was sent via <a href="https://nubo.email" style="color: #2563eb;">Nubo Meet</a>
          </p>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    await resend().emails.send({
      from: 'Nubo Meet <noreply@nubo.email>',
      to: inviteeEmail,
      subject: `Meeting Invitation: ${title}`,
      html: emailHtml,
      attachments: [
        {
          filename: 'invite.ics',
          content: btoa(icsContent),
          content_type: 'text/calendar; method=REQUEST',
        },
      ],
    });
    console.log(`[LiveKit] Meeting invite sent to ${inviteeEmail}`);
  } catch (error) {
    console.error(`[LiveKit] Failed to send invite to ${inviteeEmail}:`, error);
  }
}

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
        invitees: z.array(z.string().email()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { sessionUser } = ctx;
      const meetingId = crypto.randomUUID();
      const roomName = `meeting-${meetingId}`;
      const joinUrl = `${env.VITE_PUBLIC_APP_URL}/meet/${meetingId}`;

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

      // Send invites if scheduled with invitees
      if (input.invitees && input.invitees.length > 0 && input.scheduledFor) {
        const hostName = sessionUser.name || sessionUser.email;
        const hostEmail = sessionUser.email;

        // Send invites in parallel (don't block the response)
        Promise.all(
          input.invitees.map((inviteeEmail) =>
            sendMeetingInvite(
              inviteeEmail,
              meetingId,
              input.title,
              input.description,
              input.scheduledFor!,
              hostName,
              hostEmail,
              joinUrl,
            ),
          ),
        ).catch((error) => {
          console.error('[LiveKit] Error sending meeting invites:', error);
        });
      }

      return {
        meetingId,
        roomName,
        joinUrl,
        invitesSent: input.invitees?.length || 0,
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

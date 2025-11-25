import {
  pgTableCreator,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  primaryKey,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { defaultUserSettings } from '../lib/schemas';

export const createTable = pgTableCreator((name) => `mail0_${name}`);

export const user = createTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull(),
  image: text('image'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  defaultConnectionId: text('default_connection_id'),
  customPrompt: text('custom_prompt'),
  phoneNumber: text('phone_number').unique(),
  phoneNumberVerified: boolean('phone_number_verified'),
});

export const session = createTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [
    index('session_user_id_idx').on(t.userId),
    index('session_expires_at_idx').on(t.expiresAt),
  ],
);

export const subscription = createTable(
  'subscription',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    razorpaySubscriptionId: text('razorpay_subscription_id').unique(),
    planId: text('plan_id').notNull(), // 'free', 'pro_monthly', 'pro_annual'
    status: text('status').notNull(), // 'created', 'active', 'cancelled', 'paused', 'completed'
    currentPeriodStart: timestamp('current_period_start'),
    currentPeriodEnd: timestamp('current_period_end'),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [
    index('subscription_user_id_idx').on(t.userId),
    index('subscription_status_idx').on(t.status),
    index('subscription_razorpay_id_idx').on(t.razorpaySubscriptionId),
  ],
);

export const usageTracking = createTable(
  'usage_tracking',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    feature: text('feature').notNull(), // 'chatMessages', 'connections', 'brainActivity'
    count: integer('count').notNull().default(0),
    periodStart: timestamp('period_start').notNull(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [
    index('usage_tracking_user_id_idx').on(t.userId),
    index('usage_tracking_feature_idx').on(t.feature),
    index('usage_tracking_period_idx').on(t.periodStart),
    index('usage_tracking_user_period_feature_idx').on(t.userId, t.periodStart, t.feature),
  ],
);

export const account = createTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [
    index('account_user_id_idx').on(t.userId),
    index('account_provider_user_id_idx').on(t.providerId, t.userId),
    index('account_expires_at_idx').on(t.accessTokenExpiresAt),
  ],
);

export const userHotkeys = createTable(
  'user_hotkeys',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    shortcuts: jsonb('shortcuts').notNull(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [index('user_hotkeys_shortcuts_idx').on(t.shortcuts)],
);

export const verification = createTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (t) => [
    index('verification_identifier_idx').on(t.identifier),
    index('verification_expires_at_idx').on(t.expiresAt),
  ],
);

export const earlyAccess = createTable(
  'early_access',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull().unique(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
    isEarlyAccess: boolean('is_early_access').notNull().default(false),
    hasUsedTicket: text('has_used_ticket').default(''),
  },
  (t) => [index('early_access_is_early_access_idx').on(t.isEarlyAccess)],
);

export const connection = createTable(
  'connection',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    name: text('name'),
    picture: text('picture'),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    scope: text('scope').notNull(),
    providerId: text('provider_id').$type<'google' | 'microsoft' | 'imap'>().notNull(),
    expiresAt: timestamp('expires_at'),
    config: jsonb('config'),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [
    unique().on(t.userId, t.email),
    index('connection_user_id_idx').on(t.userId),
    index('connection_expires_at_idx').on(t.expiresAt),
    index('connection_provider_id_idx').on(t.providerId),
  ],
);

export const email = createTable(
  'email',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id').notNull(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => connection.id, { onDelete: 'cascade' }),
    messageId: text('message_id').notNull(), // Internet Message ID
    inReplyTo: text('in_reply_to'),
    references: text('references'),
    subject: text('subject'),
    from: jsonb('from').notNull(), // { name, address }
    to: jsonb('to').notNull(), // [{ name, address }]
    cc: jsonb('cc'),
    bcc: jsonb('bcc'),
    replyTo: jsonb('reply_to'),
    snippet: text('snippet'),
    bodyR2Key: text('body_r2_key'), // Key in R2 bucket
    bodyHtml: text('body_html'), // Full HTML body (for local dev, null in prod)
    internalDate: timestamp('internal_date').notNull(),
    isRead: boolean('is_read').default(false),
    isStarred: boolean('is_starred').default(false),
    labels: jsonb('labels'), // IMAP folders/labels
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('email_connection_id_idx').on(t.connectionId),
    index('email_thread_id_idx').on(t.threadId),
    index('email_message_id_idx').on(t.messageId),
    index('email_internal_date_idx').on(t.internalDate),
  ],
);

// Kanban Board Schema
export const kanbanBoard = createTable(
  'kanban_board',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    connectionId: text('connection_id')
      .notNull()
      .references(() => connection.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [
    index('kanban_board_user_id_idx').on(t.userId),
    index('kanban_board_connection_id_idx').on(t.connectionId),
    index('kanban_board_default_idx').on(t.userId, t.isDefault),
  ],
);

export const kanbanColumn = createTable(
  'kanban_column',
  {
    id: text('id').primaryKey(),
    boardId: text('board_id')
      .notNull()
      .references(() => kanbanBoard.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color'),
    position: integer('position').notNull(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [
    index('kanban_column_board_id_idx').on(t.boardId),
    index('kanban_column_board_position_idx').on(t.boardId, t.position),
  ],
);

export const kanbanEmailMapping = createTable(
  'kanban_email_mapping',
  {
    id: text('id').primaryKey(),
    columnId: text('column_id')
      .notNull()
      .references(() => kanbanColumn.id, { onDelete: 'cascade' }),
    threadId: text('thread_id').notNull(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => connection.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [
    unique().on(t.threadId, t.connectionId),
    index('kanban_email_column_id_idx').on(t.columnId),
    index('kanban_email_thread_id_idx').on(t.threadId),
    index('kanban_email_connection_id_idx').on(t.connectionId),
  ],
);

export const summary = createTable(
  'summary',
  {
    messageId: text('message_id').primaryKey(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => connection.id, { onDelete: 'cascade' }),
    saved: boolean('saved').notNull().default(false),
    tags: text('tags'),
    suggestedReply: text('suggested_reply'),
  },
  (t) => [
    index('summary_connection_id_idx').on(t.connectionId),
    index('summary_connection_id_saved_idx').on(t.connectionId, t.saved),
    index('summary_saved_idx').on(t.saved),
  ],
);

// Testing
export const note = createTable(
  'note',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    threadId: text('thread_id').notNull(),
    content: text('content').notNull(),
    color: text('color').notNull().default('default'),
    isPinned: boolean('is_pinned').default(false),
    order: integer('order').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('note_user_id_idx').on(t.userId),
    index('note_thread_id_idx').on(t.threadId),
    index('note_user_thread_idx').on(t.userId, t.threadId),
    index('note_is_pinned_idx').on(t.isPinned),
  ],
);

export const userSettings = createTable(
  'user_settings',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' })
      .unique(),
    settings: jsonb('settings')
      .$type<typeof defaultUserSettings>()
      .notNull()
      .default(defaultUserSettings),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [index('user_settings_settings_idx').on(t.settings)],
);

export const writingStyleMatrix = createTable(
  'writing_style_matrix',
  {
    connectionId: text()
      .notNull()
      .references(() => connection.id, { onDelete: 'cascade' }),
    numMessages: integer().notNull(),
    // TODO: way too much pain to get this type to work,
    // revisit later
    style: jsonb().$type<unknown>().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => {
    return [
      primaryKey({
        columns: [table.connectionId],
      }),
      index('writing_style_matrix_style_idx').on(table.style),
    ];
  },
);

export const jwks = createTable(
  'jwks',
  {
    id: text('id').primaryKey(),
    publicKey: text('public_key').notNull(),
    privateKey: text('private_key').notNull(),
    createdAt: timestamp('created_at').notNull(),
  },
  (t) => [index('jwks_created_at_idx').on(t.createdAt)],
);

export const oauthApplication = createTable(
  'oauth_application',
  {
    id: text('id').primaryKey(),
    name: text('name'),
    icon: text('icon'),
    metadata: text('metadata'),
    clientId: text('client_id').unique(),
    clientSecret: text('client_secret'),
    redirectURLs: text('redirect_u_r_ls'),
    type: text('type'),
    disabled: boolean('disabled'),
    userId: text('user_id'),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (t) => [
    index('oauth_application_user_id_idx').on(t.userId),
    index('oauth_application_disabled_idx').on(t.disabled),
  ],
);

export const oauthAccessToken = createTable(
  'oauth_access_token',
  {
    id: text('id').primaryKey(),
    accessToken: text('access_token').unique(),
    refreshToken: text('refresh_token').unique(),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    clientId: text('client_id'),
    userId: text('user_id'),
    scopes: text('scopes'),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (t) => [
    index('oauth_access_token_user_id_idx').on(t.userId),
    index('oauth_access_token_client_id_idx').on(t.clientId),
    index('oauth_access_token_expires_at_idx').on(t.accessTokenExpiresAt),
  ],
);

export const oauthConsent = createTable(
  'oauth_consent',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id'),
    userId: text('user_id'),
    scopes: text('scopes'),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
    consentGiven: boolean('consent_given'),
  },
  (t) => [
    index('oauth_consent_user_id_idx').on(t.userId),
    index('oauth_consent_client_id_idx').on(t.clientId),
    index('oauth_consent_given_idx').on(t.consentGiven),
  ],
);

// LiveKit Meeting tables
export const livekitMeeting = createTable(
  'livekit_meeting',
  {
    id: text('id').primaryKey(),
    roomName: text('room_name').notNull().unique(),
    title: text('title').notNull(),
    description: text('description'),
    hostId: text('host_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    scheduledFor: timestamp('scheduled_for'),
    startedAt: timestamp('started_at'),
    endedAt: timestamp('ended_at'),
    duration: integer('duration'), // in seconds
    status: text('status').notNull().default('scheduled'), // scheduled, active, ended, cancelled
    maxParticipants: integer('max_participants').default(50),
    recordingEnabled: boolean('recording_enabled').default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('livekit_meeting_host_id_idx').on(t.hostId),
    index('livekit_meeting_room_name_idx').on(t.roomName),
    index('livekit_meeting_status_idx').on(t.status),
    index('livekit_meeting_scheduled_for_idx').on(t.scheduledFor),
  ],
);

export const livekitParticipant = createTable(
  'livekit_participant',
  {
    id: text('id').primaryKey(),
    meetingId: text('meeting_id')
      .notNull()
      .references(() => livekitMeeting.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    identity: text('identity').notNull(), // LiveKit participant identity
    name: text('name').notNull(),
    joinedAt: timestamp('joined_at').notNull().defaultNow(),
    leftAt: timestamp('left_at'),
    duration: integer('duration'), // seconds in meeting
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('livekit_participant_meeting_id_idx').on(t.meetingId),
    index('livekit_participant_user_id_idx').on(t.userId),
    index('livekit_participant_identity_idx').on(t.identity),
  ],
);

export const livekitRecording = createTable(
  'livekit_recording',
  {
    id: text('id').primaryKey(),
    meetingId: text('meeting_id')
      .notNull()
      .references(() => livekitMeeting.id, { onDelete: 'cascade' }),
    egressId: text('egress_id').notNull(), // LiveKit egress ID
    r2Key: text('r2_key').notNull(),
    fileName: text('file_name').notNull(),
    fileSize: integer('file_size'), // bytes
    duration: integer('duration'), // seconds
    format: text('format').default('mp4'),
    status: text('status').notNull().default('processing'), // processing, ready, failed
    startedAt: timestamp('started_at').notNull(),
    endedAt: timestamp('ended_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('livekit_recording_meeting_id_idx').on(t.meetingId),
    index('livekit_recording_egress_id_idx').on(t.egressId),
    index('livekit_recording_status_idx').on(t.status),
  ],
);

export const emailTemplate = createTable(
  'email_template',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    subject: text('subject'),
    body: text('body'),
    to: jsonb('to'),
    cc: jsonb('cc'),
    bcc: jsonb('bcc'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_mail0_email_template_user_id').on(t.userId),
    unique('mail0_email_template_user_id_name_unique').on(t.userId, t.name),
  ],
);

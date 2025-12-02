CREATE TABLE "mail0_kanban_board" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail0_kanban_column" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"position" integer NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail0_kanban_email_mapping" (
	"id" text PRIMARY KEY NOT NULL,
	"column_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "mail0_kanban_email_mapping_thread_id_connection_id_unique" UNIQUE("thread_id","connection_id")
);
--> statement-breakpoint
CREATE TABLE "mail0_livekit_meeting" (
	"id" text PRIMARY KEY NOT NULL,
	"room_name" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"host_id" text NOT NULL,
	"scheduled_for" timestamp,
	"started_at" timestamp,
	"ended_at" timestamp,
	"duration" integer,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"max_participants" integer DEFAULT 50,
	"recording_enabled" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mail0_livekit_meeting_room_name_unique" UNIQUE("room_name")
);
--> statement-breakpoint
CREATE TABLE "mail0_livekit_participant" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_id" text NOT NULL,
	"user_id" text,
	"identity" text NOT NULL,
	"name" text NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"left_at" timestamp,
	"duration" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail0_livekit_recording" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_id" text NOT NULL,
	"egress_id" text NOT NULL,
	"r2_key" text NOT NULL,
	"file_name" text NOT NULL,
	"file_size" integer,
	"duration" integer,
	"format" text DEFAULT 'mp4',
	"status" text DEFAULT 'processing' NOT NULL,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail0_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"razorpay_subscription_id" text,
	"plan_id" text NOT NULL,
	"status" text NOT NULL,
	"current_period_start" timestamp,
	"current_period_end" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "mail0_subscription_razorpay_subscription_id_unique" UNIQUE("razorpay_subscription_id")
);
--> statement-breakpoint
CREATE TABLE "mail0_usage_tracking" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"feature" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"period_start" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail0_account" DROP CONSTRAINT "mail0_account_user_id_mail0_user_id_fk";
--> statement-breakpoint
ALTER TABLE "mail0_connection" DROP CONSTRAINT "mail0_connection_user_id_mail0_user_id_fk";
--> statement-breakpoint
ALTER TABLE "mail0_session" DROP CONSTRAINT "mail0_session_user_id_mail0_user_id_fk";
--> statement-breakpoint
ALTER TABLE "mail0_user_hotkeys" DROP CONSTRAINT "mail0_user_hotkeys_user_id_mail0_user_id_fk";
--> statement-breakpoint
ALTER TABLE "mail0_user_settings" DROP CONSTRAINT "mail0_user_settings_user_id_mail0_user_id_fk";
--> statement-breakpoint
ALTER TABLE "mail0_user_settings" ALTER COLUMN "settings" SET DEFAULT '{"language":"en","timezone":"UTC","dynamicContent":false,"externalImages":true,"customPrompt":"","trustedSenders":[],"isOnboarded":false,"colorTheme":"system","zeroSignature":true,"autoRead":true,"defaultEmailAlias":"","categories":[{"id":"Important","name":"Important","searchValue":"IMPORTANT","order":0,"icon":"Lightning","isDefault":false},{"id":"All Mail","name":"All Mail","searchValue":"","order":1,"icon":"Mail","isDefault":true},{"id":"Unread","name":"Unread","searchValue":"UNREAD","order":5,"icon":"ScanEye","isDefault":false}],"undoSendEnabled":false,"imageCompression":"medium","animations":false}'::jsonb;--> statement-breakpoint
ALTER TABLE "mail0_kanban_board" ADD CONSTRAINT "mail0_kanban_board_user_id_mail0_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."mail0_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_kanban_board" ADD CONSTRAINT "mail0_kanban_board_connection_id_mail0_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."mail0_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_kanban_column" ADD CONSTRAINT "mail0_kanban_column_board_id_mail0_kanban_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."mail0_kanban_board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_kanban_email_mapping" ADD CONSTRAINT "mail0_kanban_email_mapping_column_id_mail0_kanban_column_id_fk" FOREIGN KEY ("column_id") REFERENCES "public"."mail0_kanban_column"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_kanban_email_mapping" ADD CONSTRAINT "mail0_kanban_email_mapping_connection_id_mail0_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."mail0_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_livekit_meeting" ADD CONSTRAINT "mail0_livekit_meeting_host_id_mail0_user_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."mail0_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_livekit_participant" ADD CONSTRAINT "mail0_livekit_participant_meeting_id_mail0_livekit_meeting_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."mail0_livekit_meeting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_livekit_participant" ADD CONSTRAINT "mail0_livekit_participant_user_id_mail0_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."mail0_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_livekit_recording" ADD CONSTRAINT "mail0_livekit_recording_meeting_id_mail0_livekit_meeting_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."mail0_livekit_meeting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_subscription" ADD CONSTRAINT "mail0_subscription_user_id_mail0_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."mail0_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_usage_tracking" ADD CONSTRAINT "mail0_usage_tracking_user_id_mail0_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."mail0_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kanban_board_user_id_idx" ON "mail0_kanban_board" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "kanban_board_connection_id_idx" ON "mail0_kanban_board" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "kanban_board_default_idx" ON "mail0_kanban_board" USING btree ("user_id","is_default");--> statement-breakpoint
CREATE INDEX "kanban_column_board_id_idx" ON "mail0_kanban_column" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "kanban_column_board_position_idx" ON "mail0_kanban_column" USING btree ("board_id","position");--> statement-breakpoint
CREATE INDEX "kanban_email_column_id_idx" ON "mail0_kanban_email_mapping" USING btree ("column_id");--> statement-breakpoint
CREATE INDEX "kanban_email_thread_id_idx" ON "mail0_kanban_email_mapping" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "kanban_email_connection_id_idx" ON "mail0_kanban_email_mapping" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "livekit_meeting_host_id_idx" ON "mail0_livekit_meeting" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "livekit_meeting_room_name_idx" ON "mail0_livekit_meeting" USING btree ("room_name");--> statement-breakpoint
CREATE INDEX "livekit_meeting_status_idx" ON "mail0_livekit_meeting" USING btree ("status");--> statement-breakpoint
CREATE INDEX "livekit_meeting_scheduled_for_idx" ON "mail0_livekit_meeting" USING btree ("scheduled_for");--> statement-breakpoint
CREATE INDEX "livekit_participant_meeting_id_idx" ON "mail0_livekit_participant" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "livekit_participant_user_id_idx" ON "mail0_livekit_participant" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "livekit_participant_identity_idx" ON "mail0_livekit_participant" USING btree ("identity");--> statement-breakpoint
CREATE INDEX "livekit_recording_meeting_id_idx" ON "mail0_livekit_recording" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "livekit_recording_egress_id_idx" ON "mail0_livekit_recording" USING btree ("egress_id");--> statement-breakpoint
CREATE INDEX "livekit_recording_status_idx" ON "mail0_livekit_recording" USING btree ("status");--> statement-breakpoint
CREATE INDEX "subscription_user_id_idx" ON "mail0_subscription" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscription_status_idx" ON "mail0_subscription" USING btree ("status");--> statement-breakpoint
CREATE INDEX "subscription_razorpay_id_idx" ON "mail0_subscription" USING btree ("razorpay_subscription_id");--> statement-breakpoint
CREATE INDEX "usage_tracking_user_id_idx" ON "mail0_usage_tracking" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "usage_tracking_feature_idx" ON "mail0_usage_tracking" USING btree ("feature");--> statement-breakpoint
CREATE INDEX "usage_tracking_period_idx" ON "mail0_usage_tracking" USING btree ("period_start");--> statement-breakpoint
CREATE INDEX "usage_tracking_user_period_feature_idx" ON "mail0_usage_tracking" USING btree ("user_id","period_start","feature");--> statement-breakpoint
ALTER TABLE "mail0_account" ADD CONSTRAINT "mail0_account_user_id_mail0_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."mail0_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_connection" ADD CONSTRAINT "mail0_connection_user_id_mail0_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."mail0_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_session" ADD CONSTRAINT "mail0_session_user_id_mail0_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."mail0_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_summary" ADD CONSTRAINT "mail0_summary_connection_id_mail0_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."mail0_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_user_hotkeys" ADD CONSTRAINT "mail0_user_hotkeys_user_id_mail0_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."mail0_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_user_settings" ADD CONSTRAINT "mail0_user_settings_user_id_mail0_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."mail0_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "mail0_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "account_provider_user_id_idx" ON "mail0_account" USING btree ("provider_id","user_id");--> statement-breakpoint
CREATE INDEX "account_expires_at_idx" ON "mail0_account" USING btree ("access_token_expires_at");--> statement-breakpoint
CREATE INDEX "connection_user_id_idx" ON "mail0_connection" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "connection_expires_at_idx" ON "mail0_connection" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "connection_provider_id_idx" ON "mail0_connection" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "early_access_is_early_access_idx" ON "mail0_early_access" USING btree ("is_early_access");--> statement-breakpoint
CREATE INDEX "jwks_created_at_idx" ON "mail0_jwks" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "note_user_id_idx" ON "mail0_note" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "note_thread_id_idx" ON "mail0_note" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "note_user_thread_idx" ON "mail0_note" USING btree ("user_id","thread_id");--> statement-breakpoint
CREATE INDEX "note_is_pinned_idx" ON "mail0_note" USING btree ("is_pinned");--> statement-breakpoint
CREATE INDEX "oauth_access_token_user_id_idx" ON "mail0_oauth_access_token" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_access_token_client_id_idx" ON "mail0_oauth_access_token" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_access_token_expires_at_idx" ON "mail0_oauth_access_token" USING btree ("access_token_expires_at");--> statement-breakpoint
CREATE INDEX "oauth_application_user_id_idx" ON "mail0_oauth_application" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_application_disabled_idx" ON "mail0_oauth_application" USING btree ("disabled");--> statement-breakpoint
CREATE INDEX "oauth_consent_user_id_idx" ON "mail0_oauth_consent" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_consent_client_id_idx" ON "mail0_oauth_consent" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_consent_given_idx" ON "mail0_oauth_consent" USING btree ("consent_given");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "mail0_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_expires_at_idx" ON "mail0_session" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "summary_connection_id_idx" ON "mail0_summary" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "summary_connection_id_saved_idx" ON "mail0_summary" USING btree ("connection_id","saved");--> statement-breakpoint
CREATE INDEX "summary_saved_idx" ON "mail0_summary" USING btree ("saved");--> statement-breakpoint
CREATE INDEX "user_hotkeys_shortcuts_idx" ON "mail0_user_hotkeys" USING btree ("shortcuts");--> statement-breakpoint
CREATE INDEX "user_settings_settings_idx" ON "mail0_user_settings" USING btree ("settings");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "mail0_verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "verification_expires_at_idx" ON "mail0_verification" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "writing_style_matrix_style_idx" ON "mail0_writing_style_matrix" USING btree ("style");
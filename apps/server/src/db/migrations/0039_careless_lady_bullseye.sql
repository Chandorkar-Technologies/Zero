CREATE TABLE "mail0_email" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"message_id" text NOT NULL,
	"in_reply_to" text,
	"references" text,
	"subject" text,
	"from" jsonb NOT NULL,
	"to" jsonb NOT NULL,
	"cc" jsonb,
	"bcc" jsonb,
	"reply_to" jsonb,
	"snippet" text,
	"body_r2_key" text,
	"body_html" text,
	"internal_date" timestamp NOT NULL,
	"is_read" boolean DEFAULT false,
	"is_starred" boolean DEFAULT false,
	"labels" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail0_connection" ALTER COLUMN "expires_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "mail0_connection" ADD COLUMN "config" jsonb;--> statement-breakpoint
ALTER TABLE "mail0_email" ADD CONSTRAINT "mail0_email_connection_id_mail0_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."mail0_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_connection_id_idx" ON "mail0_email" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "email_thread_id_idx" ON "mail0_email" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "email_message_id_idx" ON "mail0_email" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "email_internal_date_idx" ON "mail0_email" USING btree ("internal_date");
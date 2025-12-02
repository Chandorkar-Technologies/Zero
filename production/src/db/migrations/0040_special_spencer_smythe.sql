CREATE TABLE "mail0_drive_file" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"folder_id" text,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"r2_key" text NOT NULL,
	"thumbnail_r2_key" text,
	"import_source" text,
	"source_file_id" text,
	"is_starred" boolean DEFAULT false,
	"is_trashed" boolean DEFAULT false,
	"trashed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail0_drive_folder" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" text,
	"color" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail0_drive_import_job" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_files" integer DEFAULT 0,
	"processed_files" integer DEFAULT 0,
	"failed_files" integer DEFAULT 0,
	"error_message" text,
	"source_file_ids" jsonb,
	"target_folder_id" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail0_drive_file" ADD CONSTRAINT "mail0_drive_file_user_id_mail0_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."mail0_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_drive_file" ADD CONSTRAINT "mail0_drive_file_folder_id_mail0_drive_folder_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."mail0_drive_folder"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_drive_folder" ADD CONSTRAINT "mail0_drive_folder_user_id_mail0_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."mail0_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_drive_import_job" ADD CONSTRAINT "mail0_drive_import_job_user_id_mail0_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."mail0_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail0_drive_import_job" ADD CONSTRAINT "mail0_drive_import_job_target_folder_id_mail0_drive_folder_id_fk" FOREIGN KEY ("target_folder_id") REFERENCES "public"."mail0_drive_folder"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drive_file_user_id_idx" ON "mail0_drive_file" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "drive_file_folder_id_idx" ON "mail0_drive_file" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "drive_file_user_folder_idx" ON "mail0_drive_file" USING btree ("user_id","folder_id");--> statement-breakpoint
CREATE INDEX "drive_file_mime_type_idx" ON "mail0_drive_file" USING btree ("mime_type");--> statement-breakpoint
CREATE INDEX "drive_file_is_trashed_idx" ON "mail0_drive_file" USING btree ("is_trashed");--> statement-breakpoint
CREATE INDEX "drive_file_is_starred_idx" ON "mail0_drive_file" USING btree ("is_starred");--> statement-breakpoint
CREATE INDEX "drive_file_import_source_idx" ON "mail0_drive_file" USING btree ("import_source","source_file_id");--> statement-breakpoint
CREATE INDEX "drive_folder_user_id_idx" ON "mail0_drive_folder" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "drive_folder_parent_id_idx" ON "mail0_drive_folder" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "drive_folder_user_parent_idx" ON "mail0_drive_folder" USING btree ("user_id","parent_id");--> statement-breakpoint
CREATE INDEX "drive_import_job_user_id_idx" ON "mail0_drive_import_job" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "drive_import_job_status_idx" ON "mail0_drive_import_job" USING btree ("status");--> statement-breakpoint
CREATE INDEX "drive_import_job_source_idx" ON "mail0_drive_import_job" USING btree ("source");
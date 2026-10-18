CREATE TABLE `repopilot_events` (
	`id` text PRIMARY KEY NOT NULL,
	`runId` text NOT NULL,
	`name` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`runId`) REFERENCES `repopilot_research_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `repopilot_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`runId` text NOT NULL,
	`sourceType` text NOT NULL,
	`sourceUrl` text NOT NULL,
	`sourceTitle` text NOT NULL,
	`excerpt` text NOT NULL,
	`fetchedAt` text NOT NULL,
	`externalId` text NOT NULL,
	`repoFullName` text NOT NULL,
	`metadataJson` text NOT NULL,
	FOREIGN KEY (`runId`) REFERENCES `repopilot_research_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `repopilot_evidence_run` ON `repopilot_evidence` (`runId`);--> statement-breakpoint
CREATE TABLE `repopilot_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`runId` text NOT NULL,
	`opportunityId` text NOT NULL,
	`rating` text,
	`adopted` integer DEFAULT false NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`runId`) REFERENCES `repopilot_research_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repopilot_feedback_once` ON `repopilot_feedback` (`userId`,`runId`,`opportunityId`);--> statement-breakpoint
CREATE TABLE `repopilot_research_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`repoFullName` text NOT NULL,
	`repoUrl` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`stage` text DEFAULT 'queued' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`userProfileJson` text NOT NULL,
	`repoSnapshotJson` text,
	`reportJson` text,
	`traceJson` text DEFAULT '[]' NOT NULL,
	`mode` text DEFAULT 'mock' NOT NULL,
	`errorCode` text,
	`errorMessage` text,
	`bookmarkId` text,
	`promptVersion` text,
	`modelName` text,
	`inputTokens` integer,
	`outputTokens` integer,
	`estimatedCostUsd` real,
	`leaseToken` text,
	`leaseExpiresAt` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	`startedAt` integer,
	`completedAt` integer,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bookmarkId`) REFERENCES `bookmarks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `repopilot_user_created` ON `repopilot_research_runs` (`userId`,`createdAt`);--> statement-breakpoint
CREATE UNIQUE INDEX `repopilot_one_active_user` ON `repopilot_research_runs` (`userId`) WHERE "repopilot_research_runs"."status" in ('queued', 'running');
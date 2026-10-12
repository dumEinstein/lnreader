CREATE TABLE `StoryChapter` (
	`chapterId` integer PRIMARY KEY,
	`novelId` integer NOT NULL,
	`page` integer NOT NULL,
	`position` integer NOT NULL,
	`status` text NOT NULL,
	`summary` text DEFAULT '[]' NOT NULL,
	`threads` text DEFAULT '{"opened":[],"resolved":[]}' NOT NULL,
	`model` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`indexedAt` text
);
--> statement-breakpoint
CREATE TABLE `StoryCharacterNote` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`characterId` integer NOT NULL,
	`novelId` integer NOT NULL,
	`chapterId` integer NOT NULL,
	`page` integer NOT NULL,
	`position` integer NOT NULL,
	`note` text NOT NULL,
	`relationships` text DEFAULT '[]' NOT NULL,
	`source` text DEFAULT 'ai' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `StoryCharacter` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`novelId` integer NOT NULL,
	`name` text NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`firstChapterId` integer NOT NULL,
	`firstPage` integer NOT NULL,
	`firstPosition` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `story_chapter_novel_order_idx` ON `StoryChapter` (`novelId`,`page`,`position`);--> statement-breakpoint
CREATE INDEX `story_note_character_order_idx` ON `StoryCharacterNote` (`characterId`,`page`,`position`);--> statement-breakpoint
CREATE INDEX `story_note_chapter_idx` ON `StoryCharacterNote` (`chapterId`);--> statement-breakpoint
CREATE UNIQUE INDEX `story_character_novel_name_unique` ON `StoryCharacter` (`novelId`,`name`);
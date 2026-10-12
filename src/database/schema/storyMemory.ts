import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/**
 * Story memory stores what was learned from each chapter, stamped with that
 * chapter's reading order (`page`, `position`). Every read path filters on
 * that order against a cutoff chapter, which is what keeps recall spoiler free.
 *
 * `page` is stored as an integer here (Chapter.page is text) so the ordering
 * comparison stays a plain numeric one.
 */
export const storyCharacter = sqliteTable(
  'StoryCharacter',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    novelId: integer('novelId').notNull(),
    name: text('name').notNull(),
    /** JSON array of alternative names, e.g. titles or nicknames. */
    aliases: text('aliases').notNull().default('[]'),
    firstChapterId: integer('firstChapterId').notNull(),
    firstPage: integer('firstPage').notNull(),
    firstPosition: integer('firstPosition').notNull(),
  },
  table => [
    uniqueIndex('story_character_novel_name_unique').on(
      table.novelId,
      table.name,
    ),
  ],
);

export const storyCharacterNote = sqliteTable(
  'StoryCharacterNote',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    characterId: integer('characterId').notNull(),
    novelId: integer('novelId').notNull(),
    chapterId: integer('chapterId').notNull(),
    page: integer('page').notNull(),
    position: integer('position').notNull(),
    note: text('note').notNull(),
    /** JSON array of `{ name, relation }`. */
    relationships: text('relationships').notNull().default('[]'),
    source: text('source', { enum: ['ai', 'user'] })
      .notNull()
      .default('ai'),
  },
  table => [
    index('story_note_character_order_idx').on(
      table.characterId,
      table.page,
      table.position,
    ),
    index('story_note_chapter_idx').on(table.chapterId),
  ],
);

export const storyChapter = sqliteTable(
  'StoryChapter',
  {
    chapterId: integer('chapterId').primaryKey(),
    novelId: integer('novelId').notNull(),
    page: integer('page').notNull(),
    position: integer('position').notNull(),
    status: text('status', { enum: ['done', 'failed'] }).notNull(),
    /** JSON array of summary bullet points. */
    summary: text('summary').notNull().default('[]'),
    /** JSON `{ opened: string[], resolved: string[] }`. */
    threads: text('threads').notNull().default('{"opened":[],"resolved":[]}'),
    model: text('model'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    indexedAt: text('indexedAt'),
  },
  table => [
    index('story_chapter_novel_order_idx').on(
      table.novelId,
      table.page,
      table.position,
    ),
  ],
);

export type StoryCharacterRow = typeof storyCharacter.$inferSelect;
export type StoryCharacterNoteRow = typeof storyCharacterNote.$inferSelect;
export type StoryChapterRow = typeof storyChapter.$inferSelect;

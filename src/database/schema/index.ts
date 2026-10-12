import { category } from './category';
import { novel } from './novel';
import { chapter } from './chapter';
import { novelCategory } from './novelCategory';
import { repository } from './repository';
import {
  storyChapter,
  storyCharacter,
  storyCharacterNote,
} from './storyMemory';

export {
  category as categorySchema,
  type CategoryRow,
  type CategoryInsert,
} from './category';
export { novel as novelSchema, type NovelRow, type NovelInsert } from './novel';
export {
  chapter as chapterSchema,
  type ChapterRow,
  type ChapterInsert,
} from './chapter';
export {
  novelCategory as novelCategorySchema,
  type NovelCategoryRow,
  type NovelCategoryInsert,
} from './novelCategory';
export {
  repository as repositorySchema,
  type RepositoryRow,
  type RepositoryInsert,
} from './repository';
export {
  storyCharacter as storyCharacterSchema,
  storyCharacterNote as storyCharacterNoteSchema,
  storyChapter as storyChapterSchema,
  type StoryCharacterRow,
  type StoryCharacterNoteRow,
  type StoryChapterRow,
} from './storyMemory';

/**
 * Unified schema object containing all database tables
 * Use this with Drizzle ORM for type-safe database operations
 */
export const schema = {
  category,
  novel,
  chapter,
  novelCategory,
  repository,
  storyCharacter,
  storyCharacterNote,
  storyChapter,
} as const;

export type Schema = typeof schema;

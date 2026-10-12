import './mockDb';
import { setupTestDatabase, getTestDb, teardownTestDatabase } from './setup';
import { insertTestNovel, insertTestChapter, clearAllTables } from './testData';

import {
  getChapterRecapsBefore,
  getChaptersToIndex,
  getCharacterNotesBefore,
  getKnownCharactersBefore,
  markChapterIndexFailed,
  MAX_STORY_INDEX_ATTEMPTS,
  saveChapterExtraction,
  toStoryOrder,
} from '../StoryQueries';
import type { ChapterExtraction } from '@services/storyMemory/types';

const extraction = (
  characters: { name: string; aliases?: string[]; note: string }[],
  summary: string[] = [],
): ChapterExtraction => ({
  characters: characters.map(c => ({
    aliases: [],
    relationships: [],
    ...c,
  })),
  summary,
  threads: { opened: [], resolved: [] },
});

const save = (
  novelId: number,
  chapterId: number,
  position: number,
  data: ChapterExtraction,
) =>
  saveChapterExtraction({
    novelId,
    chapterId,
    order: { page: 1, position },
    extraction: data,
    model: 'test-model',
  });

describe('StoryQueries', () => {
  let novelId: number;
  let chapterIds: number[];

  beforeEach(async () => {
    const testDb = setupTestDatabase();
    clearAllTables(testDb);
    novelId = await insertTestNovel(testDb, { inLibrary: true });
    chapterIds = [];
    for (let position = 0; position < 4; position++) {
      chapterIds.push(
        await insertTestChapter(testDb, novelId, {
          position,
          name: `Chapter ${position + 1}`,
        }),
      );
    }
  });

  afterAll(() => {
    teardownTestDatabase();
  });

  describe('toStoryOrder', () => {
    it('parses the page like SQLite CAST does', () => {
      expect(toStoryOrder({ page: '3', position: 7 })).toEqual({
        page: 3,
        position: 7,
      });
      expect(toStoryOrder({ page: 'extra', position: null })).toEqual({
        page: 0,
        position: 0,
      });
    });
  });

  describe('getChaptersToIndex', () => {
    it('returns read chapters that are not indexed, in reading order', async () => {
      const { sqlite } = getTestDb();
      sqlite.executeSync(
        `UPDATE Chapter SET unread = 0 WHERE id IN (${chapterIds[2]}, ${chapterIds[0]})`,
      );

      const result = await getChaptersToIndex(novelId);

      expect(result.map(c => c.id)).toEqual([chapterIds[0], chapterIds[2]]);
    });

    it('skips indexed chapters and gives up after repeated failures', async () => {
      const { sqlite } = getTestDb();
      sqlite.executeSync(`UPDATE Chapter SET unread = 0`);
      await save(novelId, chapterIds[0], 0, extraction([]));
      for (let i = 0; i < MAX_STORY_INDEX_ATTEMPTS; i++) {
        await markChapterIndexFailed({
          novelId,
          chapterId: chapterIds[1],
          order: { page: 1, position: 1 },
          error: 'bad json',
        });
      }
      await markChapterIndexFailed({
        novelId,
        chapterId: chapterIds[2],
        order: { page: 1, position: 2 },
        error: 'bad json',
      });

      const result = await getChaptersToIndex(novelId);

      expect(result.map(c => c.id)).toEqual([chapterIds[2], chapterIds[3]]);
    });
  });

  describe('spoiler cutoff', () => {
    beforeEach(async () => {
      await save(
        novelId,
        chapterIds[0],
        0,
        extraction(
          [{ name: 'Ayla', note: 'A thief in the capital.' }],
          ['Ayla steals a map.'],
        ),
      );
      await save(
        novelId,
        chapterIds[2],
        2,
        extraction(
          [
            { name: 'Ayla', note: 'Revealed to be the lost princess.' },
            { name: 'Corvin', note: 'A knight hunting Ayla.' },
          ],
          ['The truth about Ayla comes out.'],
        ),
      );
    });

    it('only knows characters first seen before the cutoff', async () => {
      const atChapter2 = await getKnownCharactersBefore(novelId, {
        page: 1,
        position: 1,
      });
      expect(atChapter2.map(c => c.name)).toEqual(['Ayla']);

      const atChapter4 = await getKnownCharactersBefore(novelId, {
        page: 1,
        position: 3,
      });
      expect(atChapter4.map(c => c.name)).toEqual(['Ayla', 'Corvin']);
    });

    it('never returns notes from the cutoff chapter or later', async () => {
      const [ayla] = await getKnownCharactersBefore(novelId, {
        page: 1,
        position: 1,
      });

      const early = await getCharacterNotesBefore(ayla.id, {
        page: 1,
        position: 2,
      });
      expect(early.map(n => n.note)).toEqual(['A thief in the capital.']);

      const later = await getCharacterNotesBefore(ayla.id, {
        page: 2,
        position: 0,
      });
      expect(later.map(n => n.note)).toEqual([
        'A thief in the capital.',
        'Revealed to be the lost princess.',
      ]);
    });

    it('returns recaps before the cutoff, most recent first', async () => {
      const recaps = await getChapterRecapsBefore(
        novelId,
        { page: 1, position: 2 },
        5,
      );
      expect(recaps.map(r => r.summary)).toEqual([['Ayla steals a map.']]);

      const all = await getChapterRecapsBefore(
        novelId,
        { page: 1, position: 3 },
        5,
      );
      expect(all.map(r => r.chapterId)).toEqual([chapterIds[2], chapterIds[0]]);
    });
  });

  describe('saveChapterExtraction', () => {
    it('merges characters by alias and moves first appearance earlier', async () => {
      await save(
        novelId,
        chapterIds[2],
        2,
        extraction([{ name: 'Lord Corvin', note: 'Arrives at court.' }]),
      );
      await save(
        novelId,
        chapterIds[1],
        1,
        extraction([
          {
            name: 'Corvin',
            aliases: ['Lord Corvin'],
            note: 'Mentioned in a letter.',
          },
        ]),
      );

      const known = await getKnownCharactersBefore(novelId, {
        page: 1,
        position: 2,
      });
      expect(known).toHaveLength(1);
      expect(known[0].name).toBe('Lord Corvin');
      expect(known[0].aliases).toEqual(['Corvin']);
    });

    it('replaces AI notes when a chapter is indexed again', async () => {
      await save(
        novelId,
        chapterIds[0],
        0,
        extraction([{ name: 'Ayla', note: 'First try.' }]),
      );
      await save(
        novelId,
        chapterIds[0],
        0,
        extraction([{ name: 'Ayla', note: 'Second try.' }]),
      );

      const [ayla] = await getKnownCharactersBefore(novelId, {
        page: 1,
        position: 1,
      });
      const notes = await getCharacterNotesBefore(ayla.id, {
        page: 1,
        position: 1,
      });
      expect(notes.map(n => n.note)).toEqual(['Second try.']);
    });
  });
});

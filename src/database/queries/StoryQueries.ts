import {
  and,
  type AnyColumn,
  asc,
  desc,
  eq,
  isNull,
  lt,
  or,
  sql,
} from 'drizzle-orm';
import { dbManager } from '@database/db';
import { castInt } from '@database/manager/manager';
import {
  chapterSchema,
  storyChapterSchema,
  storyCharacterNoteSchema,
  storyCharacterSchema,
} from '@database/schema';
import type {
  ChapterExtraction,
  KnownCharacter,
  StoryOrder,
  StoryRelationship,
} from '@services/storyMemory/types';

/** Chapters that failed this many times are skipped until re-indexed by hand. */
export const MAX_STORY_INDEX_ATTEMPTS = 3;

/** Mirrors SQLite's `CAST(page AS INTEGER)`, which the chapter list sorts by. */
export const toStoryOrder = (chapter: {
  page: string | null;
  position: number | null;
}): StoryOrder => ({
  page: Number.parseInt(chapter.page ?? '', 10) || 0,
  position: chapter.position ?? 0,
});

export const isBefore = (a: StoryOrder, b: StoryOrder) =>
  a.page < b.page || (a.page === b.page && a.position < b.position);

/** The spoiler rule: rows strictly before the cutoff chapter. */
const beforeCutoff = (
  page: AnyColumn,
  position: AnyColumn,
  cutoff: StoryOrder,
) =>
  or(
    lt(page, cutoff.page),
    and(eq(page, cutoff.page), lt(position, cutoff.position)),
  );

const normalizeName = (name: string) =>
  name.trim().toLocaleLowerCase().replace(/\s+/g, ' ');

const parseJsonArray = <T>(value: string): T[] => {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/**
 * Read chapters of a novel that still need indexing, in reading order:
 * never indexed, or failed fewer than {@link MAX_STORY_INDEX_ATTEMPTS} times.
 */
export const getChaptersToIndex = (novelId: number) =>
  dbManager
    .select({
      id: chapterSchema.id,
      novelId: chapterSchema.novelId,
      path: chapterSchema.path,
      name: chapterSchema.name,
      page: chapterSchema.page,
      position: chapterSchema.position,
      isDownloaded: chapterSchema.isDownloaded,
    })
    .from(chapterSchema)
    .leftJoin(
      storyChapterSchema,
      eq(storyChapterSchema.chapterId, chapterSchema.id),
    )
    .where(
      and(
        eq(chapterSchema.novelId, novelId),
        eq(chapterSchema.unread, false),
        or(
          isNull(storyChapterSchema.chapterId),
          and(
            eq(storyChapterSchema.status, 'failed'),
            lt(storyChapterSchema.attempts, MAX_STORY_INDEX_ATTEMPTS),
          ),
        ),
      ),
    )
    .orderBy(asc(castInt(chapterSchema.page)), asc(chapterSchema.position))
    .all();

export type ChapterToIndex = Awaited<
  ReturnType<typeof getChaptersToIndex>
>[number];

/** Characters first seen before the cutoff chapter. */
export const getKnownCharactersBefore = async (
  novelId: number,
  cutoff: StoryOrder,
): Promise<(KnownCharacter & { id: number })[]> => {
  const rows = await dbManager
    .select()
    .from(storyCharacterSchema)
    .where(
      and(
        eq(storyCharacterSchema.novelId, novelId),
        beforeCutoff(
          storyCharacterSchema.firstPage,
          storyCharacterSchema.firstPosition,
          cutoff,
        ),
      ),
    )
    .orderBy(
      asc(storyCharacterSchema.firstPage),
      asc(storyCharacterSchema.firstPosition),
    )
    .all();
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    aliases: parseJsonArray<string>(row.aliases),
  }));
};

/** A character's notes from chapters before the cutoff, oldest first. */
export const getCharacterNotesBefore = async (
  characterId: number,
  cutoff: StoryOrder,
) => {
  const rows = await dbManager
    .select()
    .from(storyCharacterNoteSchema)
    .where(
      and(
        eq(storyCharacterNoteSchema.characterId, characterId),
        beforeCutoff(
          storyCharacterNoteSchema.page,
          storyCharacterNoteSchema.position,
          cutoff,
        ),
      ),
    )
    .orderBy(
      asc(storyCharacterNoteSchema.page),
      asc(storyCharacterNoteSchema.position),
      asc(storyCharacterNoteSchema.id),
    )
    .all();
  return rows.map(row => ({
    ...row,
    relationships: parseJsonArray<StoryRelationship>(row.relationships),
  }));
};

/** Summaries of indexed chapters before the cutoff, most recent first. */
export const getChapterRecapsBefore = async (
  novelId: number,
  cutoff: StoryOrder,
  limit: number,
) => {
  const rows = await dbManager
    .select()
    .from(storyChapterSchema)
    .where(
      and(
        eq(storyChapterSchema.novelId, novelId),
        eq(storyChapterSchema.status, 'done'),
        beforeCutoff(
          storyChapterSchema.page,
          storyChapterSchema.position,
          cutoff,
        ),
      ),
    )
    .orderBy(desc(storyChapterSchema.page), desc(storyChapterSchema.position))
    .limit(limit)
    .all();
  return rows.map(row => {
    let threads: ChapterExtraction['threads'] = { opened: [], resolved: [] };
    try {
      threads = { ...threads, ...JSON.parse(row.threads) };
    } catch {}
    return {
      ...row,
      summary: parseJsonArray<string>(row.summary),
      threads,
    };
  });
};

/**
 * Stores what the model extracted from one chapter. Characters are matched to
 * existing ones by name or alias, so a chapter indexed out of order still
 * merges into the same character and moves its first appearance earlier.
 * Re-indexing a chapter replaces its AI notes and keeps user notes.
 */
export const saveChapterExtraction = async ({
  novelId,
  chapterId,
  order,
  extraction,
  model,
}: {
  novelId: number;
  chapterId: number;
  order: StoryOrder;
  extraction: ChapterExtraction;
  model: string;
}) => {
  await dbManager.write(async tx => {
    await tx
      .delete(storyCharacterNoteSchema)
      .where(
        and(
          eq(storyCharacterNoteSchema.chapterId, chapterId),
          eq(storyCharacterNoteSchema.source, 'ai'),
        ),
      )
      .run();

    const existing = (
      await tx
        .select()
        .from(storyCharacterSchema)
        .where(eq(storyCharacterSchema.novelId, novelId))
        .all()
    ).map(row => ({
      ...row,
      aliases: parseJsonArray<string>(row.aliases),
    }));

    for (const character of extraction.characters) {
      const names = new Set(
        [character.name, ...character.aliases].map(normalizeName),
      );
      const match = existing.find(row =>
        [row.name, ...row.aliases].some(n => names.has(normalizeName(n))),
      );

      let characterId: number;
      if (match) {
        const known = new Set(
          [match.name, ...match.aliases].map(normalizeName),
        );
        const newAliases = [character.name, ...character.aliases].filter(
          n => !known.has(normalizeName(n)),
        );
        const movesEarlier = isBefore(order, {
          page: match.firstPage,
          position: match.firstPosition,
        });
        if (newAliases.length || movesEarlier) {
          match.aliases = [...match.aliases, ...newAliases];
          await tx
            .update(storyCharacterSchema)
            .set({
              aliases: JSON.stringify(match.aliases),
              ...(movesEarlier && {
                firstChapterId: chapterId,
                firstPage: order.page,
                firstPosition: order.position,
              }),
            })
            .where(eq(storyCharacterSchema.id, match.id))
            .run();
          if (movesEarlier) {
            match.firstChapterId = chapterId;
            match.firstPage = order.page;
            match.firstPosition = order.position;
          }
        }
        characterId = match.id;
      } else {
        const inserted = await tx
          .insert(storyCharacterSchema)
          .values({
            novelId,
            name: character.name,
            aliases: JSON.stringify(character.aliases),
            firstChapterId: chapterId,
            firstPage: order.page,
            firstPosition: order.position,
          })
          .returning()
          .get();
        existing.push({ ...inserted, aliases: character.aliases });
        characterId = inserted.id;
      }

      await tx
        .insert(storyCharacterNoteSchema)
        .values({
          characterId,
          novelId,
          chapterId,
          page: order.page,
          position: order.position,
          note: character.note,
          relationships: JSON.stringify(character.relationships),
          source: 'ai',
        })
        .run();
    }

    const row = {
      novelId,
      page: order.page,
      position: order.position,
      status: 'done' as const,
      summary: JSON.stringify(extraction.summary),
      threads: JSON.stringify(extraction.threads),
      model,
      error: null,
      indexedAt: sql`datetime('now','localtime')`,
    };
    await tx
      .insert(storyChapterSchema)
      .values({ chapterId, attempts: 1, ...row })
      .onConflictDoUpdate({
        target: storyChapterSchema.chapterId,
        set: { ...row, attempts: sql`${storyChapterSchema.attempts} + 1` },
      })
      .run();
  });
};

export const markChapterIndexFailed = async ({
  novelId,
  chapterId,
  order,
  error,
}: {
  novelId: number;
  chapterId: number;
  order: StoryOrder;
  error: string;
}) => {
  await dbManager.write(async tx => {
    await tx
      .insert(storyChapterSchema)
      .values({
        chapterId,
        novelId,
        page: order.page,
        position: order.position,
        status: 'failed',
        attempts: 1,
        error,
      })
      .onConflictDoUpdate({
        target: storyChapterSchema.chapterId,
        set: {
          status: 'failed',
          error,
          attempts: sql`${storyChapterSchema.attempts} + 1`,
        },
      })
      .run();
  });
};

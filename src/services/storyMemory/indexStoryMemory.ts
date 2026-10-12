import NativeFile from '@modules/native-file';
import { NOVEL_STORAGE } from '@utils/Storages';
import { sleep } from '@utils/sleep';
import { getString } from '@i18n/translations';
import { fetchChapter } from '@services/plugin/fetch';
import { getNovelById } from '@database/queries/NovelQueries';
import {
  ChapterToIndex,
  getChaptersToIndex,
  getKnownCharactersBefore,
  markChapterIndexFailed,
  saveChapterExtraction,
  toStoryOrder,
} from '@database/queries/StoryQueries';
import { getChapterDownloadCooldownMs } from '@hooks/persisted/useSettings';
import {
  getStoryMemorySettings,
  isStoryModelConfigured,
} from '@hooks/persisted/useStoryMemorySettings';
import type {
  BackgroundTaskExecutionContext,
  TaskProgressUpdater,
} from '@services/backgroundTasks/contracts';
import { htmlToText } from './extraction';
import { createOpenAiCompatibleModel } from './openAiCompatibleModel';
import { StoryModel, StoryModelUnavailableError } from './types';

const loadChapterHtml = async (pluginId: string, chapter: ChapterToIndex) => {
  if (chapter.isDownloaded) {
    try {
      return await NativeFile.readFile(
        `${NOVEL_STORAGE}/${pluginId}/${chapter.novelId}/${chapter.id}/index.html`,
      );
    } catch {}
  }
  const html = await fetchChapter(pluginId, chapter.path);
  // Same courtesy delay as downloads, so sources don't rate-limit the reader.
  await sleep(getChapterDownloadCooldownMs());
  return html;
};

export type IndexStoryMemoryDeps = {
  createModel: () => StoryModel;
  loadChapterHtml: typeof loadChapterHtml;
};

const defaultDeps: IndexStoryMemoryDeps = {
  createModel: () => createOpenAiCompatibleModel(getStoryMemorySettings()),
  loadChapterHtml,
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Indexes every read chapter of every story-memory novel that isn't indexed
 * yet, in reading order. Running it again is always safe: it picks up where
 * the last run stopped, so it doubles as the backfill and the retry.
 *
 * If the model can't be reached (the PC is off, say) it stops without marking
 * anything failed; the chapters are tried again on the next run.
 */
export const indexStoryMemory = async (
  setMeta: TaskProgressUpdater,
  context: BackgroundTaskExecutionContext,
  deps: IndexStoryMemoryDeps = defaultDeps,
) => {
  if (!isStoryModelConfigured(getStoryMemorySettings())) return;
  const model = deps.createModel();
  const attempted = new Set<number>();
  let indexed = 0;
  let failed = 0;

  const finish = (completionText: string) =>
    setMeta(meta => ({
      ...meta,
      isRunning: false,
      progress: 1,
      progressText: undefined,
      completionText,
    }));

  // Loop until a pass finds nothing new, so chapters finished while this task
  // was running are picked up too.
  let foundWork = true;
  while (foundWork) {
    foundWork = false;
    for (const novelId of getStoryMemorySettings().enabledNovelIds) {
      const novel = getNovelById(novelId);
      if (!novel) continue;
      const chapters = (await getChaptersToIndex(novelId)).filter(
        chapter => !attempted.has(chapter.id),
      );
      for (const chapter of chapters) {
        // Re-checked per chapter so turning a novel off takes effect promptly.
        if (!getStoryMemorySettings().enabledNovelIds.includes(novelId)) break;
        foundWork = true;
        attempted.add(chapter.id);
        setMeta(meta => ({
          ...meta,
          isRunning: true,
          progress: undefined,
          progressText: `${novel.name} · ${chapter.name}`,
        }));

        const order = toStoryOrder(chapter);
        try {
          const html = await deps.loadChapterHtml(novel.pluginId, chapter);
          const text = htmlToText(html);
          if (!text) throw new Error('Chapter has no text');
          const extraction = await model.extractChapter({
            novelName: novel.name,
            chapterName: chapter.name,
            text,
            knownCharacters: await getKnownCharactersBefore(novelId, order),
          });
          await saveChapterExtraction({
            novelId,
            chapterId: chapter.id,
            order,
            extraction,
            model: model.id,
          });
          indexed++;
        } catch (error) {
          if (error instanceof StoryModelUnavailableError) {
            finish(
              getString('storyMemory.modelUnreachable', {
                error: errorMessage(error),
              }),
            );
            return;
          }
          await markChapterIndexFailed({
            novelId,
            chapterId: chapter.id,
            order,
            error: errorMessage(error),
          });
          failed++;
        }
        // Also where a cancelled task stops; progress itself lives in the DB.
        await context.updateCheckpoint(String(indexed + failed));
      }
    }
  }

  finish(getString('storyMemory.indexSummary', { indexed, failed }));
};

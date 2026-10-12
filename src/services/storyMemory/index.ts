import { backgroundTasks } from '@services/backgroundTasks';
import {
  getStoryMemorySettings,
  isStoryModelConfigured,
} from '@hooks/persisted/useStoryMemorySettings';

export const isStoryMemoryEnabled = (novelId: number) =>
  getStoryMemorySettings().enabledNovelIds.includes(novelId);

/**
 * Queues indexing of all read, unindexed chapters. A no-op while one is
 * already queued or running, which picks up newly read chapters itself.
 */
export const queueStoryMemoryIndexing = () => {
  if (isStoryModelConfigured(getStoryMemorySettings())) {
    backgroundTasks.enqueue({ name: 'INDEX_STORY_MEMORY' });
  }
};

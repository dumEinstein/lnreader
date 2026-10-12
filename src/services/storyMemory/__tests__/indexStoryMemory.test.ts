import { indexStoryMemory } from '../indexStoryMemory';
import { StoryModel, StoryModelUnavailableError } from '../types';

const mockGetChaptersToIndex = jest.fn();
const mockGetKnownCharactersBefore = jest.fn();
const mockSaveChapterExtraction = jest.fn();
const mockMarkChapterIndexFailed = jest.fn();
const mockGetNovelById = jest.fn();
const mockGetSettings = jest.fn();

jest.mock('@database/queries/StoryQueries', () => ({
  ...jest.requireActual('@database/queries/StoryQueries'),
  getChaptersToIndex: (...args: unknown[]) => mockGetChaptersToIndex(...args),
  getKnownCharactersBefore: (...args: unknown[]) =>
    mockGetKnownCharactersBefore(...args),
  saveChapterExtraction: (...args: unknown[]) =>
    mockSaveChapterExtraction(...args),
  markChapterIndexFailed: (...args: unknown[]) =>
    mockMarkChapterIndexFailed(...args),
}));

jest.mock('@database/db', () => ({ dbManager: {} }));

jest.mock('@database/queries/NovelQueries', () => ({
  getNovelById: (...args: unknown[]) => mockGetNovelById(...args),
}));

jest.mock('@hooks/persisted/useStoryMemorySettings', () => ({
  ...jest.requireActual('@hooks/persisted/useStoryMemorySettings'),
  getStoryMemorySettings: () => mockGetSettings(),
}));

jest.mock('@hooks/persisted/useSettings', () => ({
  getChapterDownloadCooldownMs: () => 0,
}));

jest.mock('@services/plugin/fetch', () => ({ fetchChapter: jest.fn() }));

jest.mock('@i18n/translations', () => ({
  getString: (key: string, params?: object) =>
    params ? `${key} ${JSON.stringify(params)}` : key,
}));

const chapter = (id: number) => ({
  id,
  novelId: 7,
  path: `/c/${id}`,
  name: `Chapter ${id}`,
  page: '1',
  position: id,
  isDownloaded: true,
});

const settings = {
  baseUrl: 'http://pc:11434/v1',
  model: 'qwen3:8b',
  apiKey: '',
  contextTokens: 8192,
  enabledNovelIds: [7],
};

const extraction = {
  characters: [],
  summary: ['Something happens.'],
  threads: { opened: [], resolved: [] },
};

const run = (model: Partial<StoryModel>, html = '<p>Ayla ran.</p>') => {
  const metas: Record<string, unknown>[] = [];
  const setMeta = jest.fn(transform => {
    metas.push(transform(metas[metas.length - 1] ?? {}));
  });
  const context = { updateCheckpoint: jest.fn().mockResolvedValue(undefined) };
  const promise = indexStoryMemory(setMeta, context, {
    createModel: () =>
      ({
        id: 'test-model',
        checkConnection: jest.fn(),
        ...model,
      } as StoryModel),
    loadChapterHtml: jest.fn().mockResolvedValue(html),
  });
  return { promise, metas, context };
};

describe('indexStoryMemory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSettings.mockReturnValue(settings);
    mockGetNovelById.mockReturnValue({
      id: 7,
      name: 'Novel',
      pluginId: 'p',
    });
    mockGetKnownCharactersBefore.mockResolvedValue([]);
  });

  it('indexes read chapters in order, giving the model only earlier characters', async () => {
    mockGetChaptersToIndex
      .mockResolvedValueOnce([chapter(1), chapter(2)])
      .mockResolvedValue([]);
    const extractChapter = jest.fn().mockResolvedValue(extraction);

    const { promise, metas, context } = run({ extractChapter });
    await promise;

    expect(extractChapter).toHaveBeenCalledTimes(2);
    expect(extractChapter.mock.calls[0][0].text).toBe('Ayla ran.');
    expect(mockGetKnownCharactersBefore).toHaveBeenNthCalledWith(1, 7, {
      page: 1,
      position: 1,
    });
    expect(mockGetKnownCharactersBefore).toHaveBeenNthCalledWith(2, 7, {
      page: 1,
      position: 2,
    });
    expect(mockSaveChapterExtraction).toHaveBeenCalledWith(
      expect.objectContaining({ chapterId: 2, model: 'test-model' }),
    );
    expect(context.updateCheckpoint).toHaveBeenCalledTimes(2);
    expect(metas[metas.length - 1].completionText).toContain(
      'storyMemory.indexSummary',
    );
  });

  it('picks up chapters read while it was running', async () => {
    mockGetChaptersToIndex
      .mockResolvedValueOnce([chapter(1)])
      .mockResolvedValueOnce([chapter(1), chapter(2)])
      .mockResolvedValue([]);
    const extractChapter = jest.fn().mockResolvedValue(extraction);

    await run({ extractChapter }).promise;

    expect(extractChapter).toHaveBeenCalledTimes(2);
  });

  it('marks a chapter failed and moves on when its extraction fails', async () => {
    mockGetChaptersToIndex
      .mockResolvedValueOnce([chapter(1), chapter(2)])
      .mockResolvedValue([chapter(1)]);
    const extractChapter = jest
      .fn()
      .mockRejectedValueOnce(new Error('bad json'))
      .mockResolvedValue(extraction);

    await run({ extractChapter }).promise;

    expect(mockMarkChapterIndexFailed).toHaveBeenCalledWith(
      expect.objectContaining({ chapterId: 1, error: 'bad json' }),
    );
    expect(mockSaveChapterExtraction).toHaveBeenCalledTimes(1);
    // A chapter that failed in this run is not retried within the same run.
    expect(extractChapter).toHaveBeenCalledTimes(2);
  });

  it('stops without marking anything failed when the model is unreachable', async () => {
    mockGetChaptersToIndex.mockResolvedValue([chapter(1), chapter(2)]);
    const extractChapter = jest
      .fn()
      .mockRejectedValue(new StoryModelUnavailableError('PC is off'));

    const { promise, metas } = run({ extractChapter });
    await promise;

    expect(extractChapter).toHaveBeenCalledTimes(1);
    expect(mockMarkChapterIndexFailed).not.toHaveBeenCalled();
    expect(metas[metas.length - 1].completionText).toContain(
      'storyMemory.modelUnreachable',
    );
  });

  it('does nothing until a model server is configured', async () => {
    mockGetSettings.mockReturnValue({ ...settings, baseUrl: '' });
    const extractChapter = jest.fn();

    await run({ extractChapter }).promise;

    expect(mockGetChaptersToIndex).not.toHaveBeenCalled();
  });
});

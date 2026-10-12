import { useCallback } from 'react';
import { useMMKVObject } from 'react-native-mmkv';
import { getMMKVObject } from '@utils/mmkv/mmkv';

export const STORY_MEMORY_SETTINGS = 'STORY_MEMORY_SETTINGS';

export interface StoryMemorySettings {
  /**
   * Base URL of an OpenAI-compatible server, including the `/v1` suffix,
   * e.g. `http://192.168.1.20:11434/v1` for Ollama on the local network.
   */
  baseUrl: string;
  model: string;
  /** Optional; local servers usually do not need one. */
  apiKey: string;
  /** The model's context window in tokens; long chapters are split to fit. */
  contextTokens: number;
  /** Novels whose read chapters are indexed. */
  enabledNovelIds: number[];
}

export const initialStoryMemorySettings: StoryMemorySettings = {
  baseUrl: '',
  model: '',
  apiKey: '',
  contextTokens: 8192,
  enabledNovelIds: [],
};

/** Reads the settings without subscribing; safe in background tasks. */
export const getStoryMemorySettings = (): StoryMemorySettings => ({
  ...initialStoryMemorySettings,
  ...getMMKVObject<Partial<StoryMemorySettings>>(STORY_MEMORY_SETTINGS),
});

export const isStoryModelConfigured = (settings: StoryMemorySettings) =>
  Boolean(settings.baseUrl.trim() && settings.model.trim());

export const useStoryMemorySettings = () => {
  const [stored, setStored] = useMMKVObject<Partial<StoryMemorySettings>>(
    STORY_MEMORY_SETTINGS,
  );
  const settings = { ...initialStoryMemorySettings, ...stored };

  const setStoryMemorySettings = useCallback(
    (values: Partial<StoryMemorySettings>) =>
      setStored({ ...getStoryMemorySettings(), ...values }),
    [setStored],
  );

  return { ...settings, setStoryMemorySettings };
};

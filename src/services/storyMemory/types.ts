/** Reading order of a chapter: `(page, position)`, as the chapter list sorts it. */
export type StoryOrder = { page: number; position: number };

export type StoryRelationship = { name: string; relation: string };

export type ExtractedCharacter = {
  name: string;
  aliases: string[];
  note: string;
  relationships: StoryRelationship[];
};

export type ChapterExtraction = {
  characters: ExtractedCharacter[];
  summary: string[];
  threads: { opened: string[]; resolved: string[] };
};

export type KnownCharacter = { name: string; aliases: string[] };

export type ExtractChapterInput = {
  novelName: string;
  chapterName: string;
  text: string;
  /** Characters first seen before this chapter; never anything later. */
  knownCharacters: KnownCharacter[];
  signal?: AbortSignal;
};

/**
 * Everything story memory asks of a language model. The local
 * OpenAI-compatible endpoint is the first implementation; an on-device model
 * is meant to slot in behind the same interface.
 */
export interface StoryModel {
  /** Identifies the backend and model, stored with each indexed chapter. */
  readonly id: string;
  extractChapter(input: ExtractChapterInput): Promise<ChapterExtraction>;
  /** Resolves with the models the backend offers, or rejects if unreachable. */
  checkConnection(signal?: AbortSignal): Promise<string[]>;
}

/** The model could not be reached; the chapter should be retried later. */
export class StoryModelUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StoryModelUnavailableError';
  }
}

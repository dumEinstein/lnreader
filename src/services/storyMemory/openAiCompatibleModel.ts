import {
  buildExtractionMessages,
  buildExtractionPrompt,
  extractJsonObject,
  getChunkCharBudget,
  mergeExtractions,
  RESPONSE_TOKENS,
  sanitizeExtraction,
  splitIntoChunks,
} from './extraction';
import {
  ChapterExtraction,
  ExtractChapterInput,
  KnownCharacter,
  StoryModel,
  StoryModelUnavailableError,
} from './types';

/** Local models on modest hardware can take minutes per chapter. */
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const CONNECTION_TIMEOUT_MS = 10 * 1000;

type Config = {
  baseUrl: string;
  model: string;
  apiKey?: string;
  contextTokens: number;
};

type FetchLike = typeof fetch;

const withTimeout = (ms: number, outer?: AbortSignal) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const onAbort = () => controller.abort();
  outer?.addEventListener('abort', onAbort);
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onAbort);
    },
  };
};

/**
 * Talks to any server with an OpenAI-compatible chat API: Ollama, LM Studio,
 * llama.cpp's server, vLLM and similar, on the reader's PC or home network.
 */
export const createOpenAiCompatibleModel = (
  config: Config,
  fetchImpl: FetchLike = fetch,
): StoryModel => {
  const baseUrl = config.baseUrl.trim().replace(/\/+$/, '');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(config.apiKey?.trim() && {
      Authorization: `Bearer ${config.apiKey.trim()}`,
    }),
  };

  const request = async (
    path: string,
    init: RequestInit,
    timeoutMs: number,
    outer?: AbortSignal,
  ) => {
    const timeout = withTimeout(timeoutMs, outer);
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers,
        signal: timeout.signal,
      });
    } catch (error) {
      throw new StoryModelUnavailableError(
        `Could not reach the model at ${baseUrl}`,
        { cause: error },
      );
    } finally {
      timeout.done();
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const message = `Model server returned ${response.status}: ${body.slice(
        0,
        200,
      )}`;
      // A wrong URL, unknown model or a busy server will not be fixed by
      // retrying this chapter right away; anything else is the chapter's own.
      if ([401, 403, 404, 408, 429].includes(response.status)) {
        throw new StoryModelUnavailableError(message);
      }
      if (response.status >= 500) {
        throw new StoryModelUnavailableError(message);
      }
      throw new Error(message);
    }
    return response.json();
  };

  const complete = async (prompt: string, signal?: AbortSignal) => {
    const data = await request(
      '/chat/completions',
      {
        method: 'POST',
        body: JSON.stringify({
          model: config.model,
          messages: buildExtractionMessages(prompt),
          temperature: 0.2,
          max_tokens: RESPONSE_TOKENS,
          stream: false,
        }),
      },
      REQUEST_TIMEOUT_MS,
      signal,
    );
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('Model reply had no message content');
    }
    return content;
  };

  const extractPart = async (
    prompt: string,
    text: string,
    known: KnownCharacter[],
    signal?: AbortSignal,
  ): Promise<ChapterExtraction> => {
    let lastError: unknown;
    // Small models occasionally produce malformed JSON; one retry usually fixes it.
    for (let attempt = 0; attempt < 2; attempt++) {
      const reply = await complete(prompt, signal);
      try {
        return sanitizeExtraction(extractJsonObject(reply), text, known);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  };

  return {
    id: `openai-compatible:${config.model}`,

    async extractChapter({
      novelName,
      chapterName,
      text,
      knownCharacters,
      signal,
    }: ExtractChapterInput) {
      const known = [...knownCharacters];
      const chunks = splitIntoChunks(
        text,
        getChunkCharBudget(config.contextTokens, known),
      );
      const parts: ChapterExtraction[] = [];
      for (let index = 0; index < chunks.length; index++) {
        const prompt = buildExtractionPrompt({
          novelName,
          chapterName,
          text: chunks[index],
          knownCharacters: known,
          part: { index, total: chunks.length },
        });
        const part = await extractPart(prompt, chunks[index], known, signal);
        parts.push(part);
        // Later parts of the same chapter may refer to people from earlier parts.
        for (const character of part.characters) {
          if (!known.some(k => k.name === character.name)) {
            known.push({ name: character.name, aliases: character.aliases });
          }
        }
      }
      return mergeExtractions(parts);
    },

    async checkConnection(signal?: AbortSignal) {
      const data = await request(
        '/models',
        { method: 'GET' },
        CONNECTION_TIMEOUT_MS,
        signal,
      );
      return Array.isArray(data?.data)
        ? data.data
            .map((m: { id?: unknown }) => m?.id)
            .filter((id: unknown): id is string => typeof id === 'string')
        : [];
    },
  };
};

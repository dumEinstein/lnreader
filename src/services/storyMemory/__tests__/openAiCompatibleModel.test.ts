import { createOpenAiCompatibleModel } from '../openAiCompatibleModel';
import { StoryModelUnavailableError } from '../types';

const reply = (content: string, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => content,
  } as unknown as Response);

const config = {
  baseUrl: 'http://192.168.1.20:11434/v1/',
  model: 'qwen3:8b',
  apiKey: '',
  contextTokens: 8192,
};

const input = {
  novelName: 'Test Novel',
  chapterName: 'Chapter 1',
  text: 'Ayla stole the map.',
  knownCharacters: [],
};

describe('createOpenAiCompatibleModel', () => {
  it('posts the chapter to the chat completions endpoint', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(
        reply(
          '{"characters":[{"name":"Ayla","note":"A thief."}],"summary":["Ayla steals a map."]}',
        ),
      );
    const model = createOpenAiCompatibleModel(config, fetchMock);

    const result = await model.extractChapter(input);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://192.168.1.20:11434/v1/chat/completions');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('qwen3:8b');
    expect(body.messages[1].content).toContain('Ayla stole the map.');
    expect(init.headers.Authorization).toBeUndefined();
    expect(result.characters.map(c => c.name)).toEqual(['Ayla']);
    expect(model.id).toBe('openai-compatible:qwen3:8b');
  });

  it('retries once when the reply is not JSON', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(reply('I cannot help with that'))
      .mockResolvedValueOnce(reply('{"summary":["ok"]}'));
    const model = createOpenAiCompatibleModel(config, fetchMock);

    const result = await model.extractChapter(input);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.summary).toEqual(['ok']);
  });

  it('reports an unreachable server as unavailable, not as a bad chapter', async () => {
    const model = createOpenAiCompatibleModel(
      config,
      jest.fn().mockRejectedValue(new TypeError('Network request failed')),
    );
    await expect(model.extractChapter(input)).rejects.toBeInstanceOf(
      StoryModelUnavailableError,
    );
  });

  it('treats an unknown model as unavailable and a bad request as a chapter error', async () => {
    const notFound = createOpenAiCompatibleModel(
      config,
      jest.fn().mockResolvedValue(reply('model not found', 404)),
    );
    await expect(notFound.extractChapter(input)).rejects.toBeInstanceOf(
      StoryModelUnavailableError,
    );

    const badRequest = createOpenAiCompatibleModel(
      config,
      jest.fn().mockResolvedValue(reply('context too long', 400)),
    );
    const error = await badRequest.extractChapter(input).catch(e => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(StoryModelUnavailableError);
  });

  it('splits a chapter that does not fit the context window', async () => {
    const fetchMock = jest.fn().mockResolvedValue(reply('{"summary":["x"]}'));
    const model = createOpenAiCompatibleModel(
      { ...config, contextTokens: 2048 },
      fetchMock,
    );
    const paragraph = 'Ayla walked on. '.repeat(100);

    const result = await model.extractChapter({
      ...input,
      text: Array(10).fill(paragraph).join('\n'),
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    expect(result.summary.length).toBe(fetchMock.mock.calls.length);
  });

  it('lists models when checking the connection', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'qwen3:8b' }, { id: 'llama3.1' }] }),
    });
    const model = createOpenAiCompatibleModel(
      { ...config, apiKey: 'secret' },
      fetchMock,
    );

    await expect(model.checkConnection()).resolves.toEqual([
      'qwen3:8b',
      'llama3.1',
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://192.168.1.20:11434/v1/models',
    );
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      'Bearer secret',
    );
  });
});

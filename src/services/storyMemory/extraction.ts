import * as cheerio from 'cheerio';
import type {
  ChapterExtraction,
  ExtractedCharacter,
  KnownCharacter,
  StoryRelationship,
} from './types';

const LIMITS = {
  characters: 40,
  aliases: 8,
  relationships: 10,
  summary: 8,
  threads: 8,
  name: 80,
  note: 400,
  line: 300,
};

/** Tokens kept free for the model's answer. */
export const RESPONSE_TOKENS = 1500;
/** Conservative characters-per-token estimate so prompts never overflow. */
const CHARS_PER_TOKEN = 3;
const MIN_CHUNK_CHARS = 2000;

const BLOCK_TAGS = 'p, div, br, li, h1, h2, h3, h4, h5, h6, blockquote, tr';

export const htmlToText = (html: string) => {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  $(BLOCK_TAGS).after('\n');
  return $.root()
    .text()
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

/** Splits on paragraph boundaries so no chunk exceeds `maxChars`. */
export const splitIntoChunks = (text: string, maxChars: number) => {
  const chunks: string[] = [];
  let current = '';
  for (const paragraph of text.split('\n')) {
    const pieces =
      paragraph.length > maxChars
        ? paragraph.match(new RegExp(`[^]{1,${maxChars}}`, 'g')) ?? []
        : [paragraph];
    for (const piece of pieces) {
      if (current && current.length + piece.length + 1 > maxChars) {
        chunks.push(current);
        current = '';
      }
      current = current ? `${current}\n${piece}` : piece;
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks;
};

const SYSTEM_PROMPT = `You write private story notes that help a reader remember characters and plot after a break.
Use ONLY the chapter text you are given. Never use outside knowledge of this novel, its adaptations or its sequels, even if you recognise it, and never guess what happens later.
Reply with one JSON object and nothing else.`;

const describeKnown = (known: KnownCharacter[]) =>
  known.length
    ? known
        .map(c =>
          c.aliases.length
            ? `${c.name} (also: ${c.aliases.join(', ')})`
            : c.name,
        )
        .join('; ')
    : 'none yet';

export const buildExtractionPrompt = ({
  novelName,
  chapterName,
  text,
  knownCharacters,
  part,
}: {
  novelName: string;
  chapterName: string;
  text: string;
  knownCharacters: KnownCharacter[];
  part?: { index: number; total: number };
}) => `Novel: ${novelName}
Chapter: ${chapterName}${
  part && part.total > 1 ? ` (part ${part.index + 1} of ${part.total})` : ''
}

Characters the reader already knows: ${describeKnown(knownCharacters)}

Return JSON shaped exactly like this:
{"characters":[{"name":"","aliases":[],"note":"","relationships":[{"name":"","relation":""}]}],"summary":[],"threads":{"opened":[],"resolved":[]}}

Rules:
- characters: everyone who appears or is meaningfully mentioned in this text. For a character the reader already knows, use the exact name listed above. "aliases" are other names used for them in this text. "note" is one or two sentences on who they are and what they do here. "relationships" lists ties to other characters stated in this text.
- summary: 3 to 5 short bullet points of what happens, in order.
- threads.opened: new mysteries, goals or promises left unresolved. threads.resolved: earlier ones answered here.
- Write plainly and only about this text.

Chapter text:
"""
${text}
"""`;

/**
 * How many characters of chapter text fit in one request, after the
 * instructions, the known-character list and room for the answer.
 */
export const getChunkCharBudget = (
  contextTokens: number,
  knownCharacters: KnownCharacter[],
) => {
  const overhead =
    SYSTEM_PROMPT.length +
    buildExtractionPrompt({
      novelName: '',
      chapterName: '',
      text: '',
      knownCharacters,
    }).length;
  const available =
    (contextTokens - RESPONSE_TOKENS) * CHARS_PER_TOKEN - overhead - 200;
  return Math.max(MIN_CHUNK_CHARS, available);
};

export const buildExtractionMessages = (
  prompt: string,
): { role: 'system' | 'user'; content: string }[] => [
  { role: 'system', content: SYSTEM_PROMPT },
  { role: 'user', content: prompt },
];

const str = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const strList = (value: unknown, maxItems: number, maxLength: number) =>
  Array.isArray(value)
    ? value
        .map(item => str(item, maxLength))
        .filter(Boolean)
        .slice(0, maxItems)
    : [];

const normalize = (name: string) =>
  name.trim().toLocaleLowerCase().replace(/\s+/g, ' ');

/** Pulls the outermost JSON object out of a reply that may add prose or fences. */
export const extractJsonObject = (raw: string): unknown => {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('Model reply contained no JSON object');
  }
  return JSON.parse(raw.slice(start, end + 1));
};

/**
 * Validates a model reply against the expected shape and drops anything the
 * chapter text cannot back up. A character survives only if one of its names
 * actually occurs in the text, which filters out characters a model "remembers"
 * from elsewhere in the book.
 */
export const sanitizeExtraction = (
  value: unknown,
  chapterText: string,
  knownCharacters: KnownCharacter[],
): ChapterExtraction => {
  const data = (value ?? {}) as Record<string, unknown>;
  const haystack = normalize(chapterText);
  const inText = (name: string) => haystack.includes(normalize(name));
  const knownAliases = new Map(
    knownCharacters.map(c => [normalize(c.name), c.aliases]),
  );

  const characters: ExtractedCharacter[] = [];
  const rawCharacters = Array.isArray(data.characters) ? data.characters : [];
  for (const item of rawCharacters) {
    if (characters.length >= LIMITS.characters) break;
    const raw = (item ?? {}) as Record<string, unknown>;
    const name = str(raw.name, LIMITS.name);
    if (!name) continue;
    const known = knownAliases.get(normalize(name)) ?? [];
    const aliases = strList(raw.aliases, LIMITS.aliases, LIMITS.name).filter(
      alias =>
        normalize(alias) !== normalize(name) &&
        (inText(alias) || known.some(k => normalize(k) === normalize(alias))),
    );
    if (![name, ...aliases, ...known].some(inText)) continue;

    const relationships: StoryRelationship[] = (
      Array.isArray(raw.relationships) ? raw.relationships : []
    )
      .map(rel => {
        const r = (rel ?? {}) as Record<string, unknown>;
        return {
          name: str(r.name, LIMITS.name),
          relation: str(r.relation, LIMITS.name),
        };
      })
      .filter(r => r.name && r.relation)
      .slice(0, LIMITS.relationships);

    characters.push({
      name,
      aliases,
      note: str(raw.note, LIMITS.note),
      relationships,
    });
  }

  const threads = (data.threads ?? {}) as Record<string, unknown>;
  return {
    characters,
    summary: strList(data.summary, LIMITS.summary, LIMITS.line),
    threads: {
      opened: strList(threads.opened, LIMITS.threads, LIMITS.line),
      resolved: strList(threads.resolved, LIMITS.threads, LIMITS.line),
    },
  };
};

const unique = (items: string[]) => {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = normalize(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** Combines the results for the parts of a chapter that had to be split. */
export const mergeExtractions = (
  parts: ChapterExtraction[],
): ChapterExtraction => {
  const byName = new Map<string, ExtractedCharacter>();
  for (const part of parts) {
    for (const character of part.characters) {
      const key = normalize(character.name);
      const existing = byName.get(key);
      if (!existing) {
        byName.set(key, { ...character });
        continue;
      }
      existing.aliases = unique([...existing.aliases, ...character.aliases]);
      existing.note = [existing.note, character.note]
        .filter(Boolean)
        .join(' ')
        .slice(0, LIMITS.note * 2);
      existing.relationships = [
        ...existing.relationships,
        ...character.relationships,
      ].slice(0, LIMITS.relationships);
    }
  }
  return {
    characters: [...byName.values()],
    summary: parts.flatMap(p => p.summary),
    threads: {
      opened: unique(parts.flatMap(p => p.threads.opened)),
      resolved: unique(parts.flatMap(p => p.threads.resolved)),
    },
  };
};

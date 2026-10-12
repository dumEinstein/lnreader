import {
  extractJsonObject,
  htmlToText,
  mergeExtractions,
  sanitizeExtraction,
  splitIntoChunks,
} from '../extraction';

describe('htmlToText', () => {
  it('keeps paragraphs and drops markup and scripts', () => {
    expect(
      htmlToText(
        '<div><p>Ayla ran.</p><script>evil()</script><p>Corvin&nbsp;followed.<br>Fast.</p></div>',
      ),
    ).toBe('Ayla ran.\nCorvin followed.\nFast.');
  });
});

describe('splitIntoChunks', () => {
  it('splits on paragraphs without exceeding the budget', () => {
    const text = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)].join('\n');
    const chunks = splitIntoChunks(text, 90);
    expect(chunks).toEqual([
      `${'a'.repeat(40)}\n${'b'.repeat(40)}`,
      'c'.repeat(40),
    ]);
  });

  it('hard-splits a single paragraph longer than the budget', () => {
    expect(splitIntoChunks('x'.repeat(25), 10)).toEqual([
      'x'.repeat(10),
      'x'.repeat(10),
      'x'.repeat(5),
    ]);
  });
});

describe('extractJsonObject', () => {
  it('reads JSON wrapped in prose or code fences', () => {
    expect(extractJsonObject('Sure!\n```json\n{"summary":["a"]}\n```')).toEqual(
      { summary: ['a'] },
    );
  });

  it('throws when there is no object', () => {
    expect(() => extractJsonObject('no idea')).toThrow();
  });
});

describe('sanitizeExtraction', () => {
  const text = 'Ayla, called the Fox, stole the map while the guard slept.';

  it('drops characters whose names never appear in the chapter', () => {
    const result = sanitizeExtraction(
      {
        characters: [
          { name: 'Ayla', aliases: ['the Fox', 'Princess'], note: 'A thief.' },
          { name: 'Corvin', note: 'Betrays everyone in book three.' },
        ],
        summary: ['Ayla steals the map.', 42],
        threads: { opened: ['Who hired her?'] },
      },
      text,
      [],
    );
    expect(result.characters).toEqual([
      {
        name: 'Ayla',
        aliases: ['the Fox'],
        note: 'A thief.',
        relationships: [],
      },
    ]);
    expect(result.summary).toEqual(['Ayla steals the map.']);
    expect(result.threads).toEqual({
      opened: ['Who hired her?'],
      resolved: [],
    });
  });

  it('keeps a known character referred to only by a known alias', () => {
    const result = sanitizeExtraction(
      { characters: [{ name: 'Ayla Venn', note: 'Still on the run.' }] },
      'The Fox slipped away.',
      [{ name: 'Ayla Venn', aliases: ['The Fox'] }],
    );
    expect(result.characters.map(c => c.name)).toEqual(['Ayla Venn']);
  });

  it('tolerates a reply of the wrong shape', () => {
    expect(sanitizeExtraction('nonsense', text, [])).toEqual({
      characters: [],
      summary: [],
      threads: { opened: [], resolved: [] },
    });
  });
});

describe('mergeExtractions', () => {
  it('combines the parts of a split chapter', () => {
    const merged = mergeExtractions([
      {
        characters: [
          { name: 'Ayla', aliases: [], note: 'Steals.', relationships: [] },
        ],
        summary: ['One.'],
        threads: { opened: ['Who?'], resolved: [] },
      },
      {
        characters: [
          { name: 'ayla', aliases: ['Fox'], note: 'Flees.', relationships: [] },
        ],
        summary: ['Two.'],
        threads: { opened: ['who?'], resolved: [] },
      },
    ]);
    expect(merged.characters).toEqual([
      {
        name: 'Ayla',
        aliases: ['Fox'],
        note: 'Steals. Flees.',
        relationships: [],
      },
    ]);
    expect(merged.summary).toEqual(['One.', 'Two.']);
    expect(merged.threads.opened).toEqual(['Who?']);
  });
});

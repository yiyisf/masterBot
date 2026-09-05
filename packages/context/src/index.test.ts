import { describe, expect, it } from 'vitest';
import {
  deriveEffectiveContextInputLimit,
  estimateConservativeUtf8Tokens,
  slice4BaselineContextPolicy,
} from './index.js';

describe('Slice 4 baseline Context Policy', () => {
  it('conservatively estimates UTF-8 material with explicit structural framing', () => {
    expect(estimateConservativeUtf8Tokens('A界', 8)).toBe(12);
  });

  it('applies the strictest Policy limit and model capacity before reserving safety margin', () => {
    expect(deriveEffectiveContextInputLimit(
      slice4BaselineContextPolicy,
      { strictestContextWindowTokens: 65_536, maximumOutputTokens: 16_384 },
    )).toBe(45_056);

    expect(deriveEffectiveContextInputLimit(
      slice4BaselineContextPolicy,
      { strictestContextWindowTokens: 32_768, maximumOutputTokens: 4_096 },
    )).toBe(24_576);
  });

  it('rejects a model capacity that cannot preserve the Policy safety margin', () => {
    expect(() => deriveEffectiveContextInputLimit(
      slice4BaselineContextPolicy,
      { strictestContextWindowTokens: 8_192, maximumOutputTokens: 4_096 },
    )).toThrow('safety margin');
  });
});

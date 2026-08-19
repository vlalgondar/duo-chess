import { describe, expect, it } from 'vitest';
import { defaultSoundEnabled } from './sound.js';

describe('defaultSoundEnabled', () => {
  it('defaults off on a coarse-pointer (touch/mobile) device', () => {
    expect(defaultSoundEnabled(true)).toBe(false);
  });

  it('defaults on for a fine-pointer (desktop) device', () => {
    expect(defaultSoundEnabled(false)).toBe(true);
  });
});

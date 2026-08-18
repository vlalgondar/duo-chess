import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME, scaffoldGreeting } from './index.js';

describe('shared scaffold', () => {
  it('exports its package name', () => {
    expect(PACKAGE_NAME).toBe('@duo/shared');
  });

  it('greets by name', () => {
    expect(scaffoldGreeting('duo')).toBe('hello duo from @duo/shared');
  });
});

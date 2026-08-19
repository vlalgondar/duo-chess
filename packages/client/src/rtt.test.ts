import { describe, expect, it } from 'vitest';
import { rttLevel } from './rtt.js';

describe('rttLevel', () => {
  it('is green at or under the §8 150ms target', () => {
    expect(rttLevel(0)).toBe('green');
    expect(rttLevel(150)).toBe('green');
  });

  it('is yellow between 150ms and 400ms', () => {
    expect(rttLevel(151)).toBe('yellow');
    expect(rttLevel(400)).toBe('yellow');
  });

  it('is red above 400ms', () => {
    expect(rttLevel(401)).toBe('red');
    expect(rttLevel(5000)).toBe('red');
  });
});

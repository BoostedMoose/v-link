import { describe, expect, it } from 'vitest';

import { shouldAutoplayRestoredTrack } from './LocalMediaProvider';

describe('local media startup autoplay', () => {
  it('starts after projection detection when autoplay is enabled and no phone is connected', () => {
    expect(shouldAutoplayRestoredTrack(true, false, true)).toBe(true);
  });

  it('does not start before projection detection or when autoplay is disabled', () => {
    expect(shouldAutoplayRestoredTrack(false, false, true)).toBe(false);
    expect(shouldAutoplayRestoredTrack(true, false, false)).toBe(false);
  });

  it('does not compete with an active phone projection session', () => {
    expect(shouldAutoplayRestoredTrack(true, true, true)).toBe(false);
  });
});

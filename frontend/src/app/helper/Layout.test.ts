import { describe, expect, it } from 'vitest';
import {
  androidAutoRequestSize,
  carplayRequestSize,
  fitInside,
  isCompactViewport,
  projectionDisplayRect,
  smallestViewport,
} from './Layout';

describe('layout helpers', () => {
  it('constrains an oversized Chromium viewport to the visible screen', () => {
    expect(smallestViewport(
      { width: 480, height: 248 },
      { width: 480, height: 248 },
      { width: 400, height: 234 },
    )).toEqual({ width: 400, height: 234 });
  });

  it('keeps a smaller window when running outside kiosk mode', () => {
    expect(smallestViewport(
      { width: 400, height: 234 },
      { width: 1280, height: 720 },
    )).toEqual({ width: 400, height: 234 });
  });

  it.each([
    [{ width: 400, height: 234 }, true],
    [{ width: 480, height: 248 }, true],
    [{ width: 800, height: 480 }, false],
    [{ width: 1280, height: 720 }, false],
  ])('classifies viewport %o as compact=%s', (viewport, expected) => {
    expect(isCompactViewport(viewport)).toBe(expected);
  });

  it('letterboxes an 800x480 projection on a 400x234 display', () => {
    expect(fitInside(
      { width: 400, height: 234 },
      { width: 800, height: 480 },
    )).toEqual({ width: 390, height: 234, left: 5, top: 0 });
  });

  it('pillarboxes an 800x480 projection on a 480x248 display', () => {
    const fitted = fitInside(
      { width: 480, height: 248 },
      { width: 800, height: 480 },
    );

    expect(fitted.width).toBeCloseTo(413.333, 3);
    expect(fitted.height).toBeCloseTo(248, 6);
    expect(fitted.left).toBeCloseTo(33.333, 3);
    expect(fitted.top).toBe(0);
  });

  it('preserves aspect ratio only on compact projection surfaces', () => {
    expect(projectionDisplayRect(
      { width: 400, height: 234 },
      { width: 1280, height: 720 },
      true,
    )).toEqual({ width: 400, height: 225, left: 0, top: 4.5 });

    expect(projectionDisplayRect(
      { width: 1248, height: 547 },
      { width: 1280, height: 720 },
      false,
    )).toEqual({ width: 1248, height: 547, left: 0, top: 0 });
  });

  it('snaps Android Auto to a standard size on compact screens', () => {
    expect(androidAutoRequestSize({ width: 400, height: 234 }))
      .toEqual({ width: 800, height: 480 });
    expect(androidAutoRequestSize({ width: 480, height: 248 }))
      .toEqual({ width: 800, height: 480 });
  });

  it('always snaps Android Auto on larger screens', () => {
    expect(androidAutoRequestSize({ width: 800, height: 440 }))
      .toEqual({ width: 800, height: 480 });
    expect(androidAutoRequestSize({ width: 1248, height: 547 }))
      .toEqual({ width: 1280, height: 720 });
    expect(androidAutoRequestSize({ width: 1280, height: 720 }))
      .toEqual({ width: 1280, height: 720 });
  });

  it('uses a known-good 720p CarPlay stream on compact screens', () => {
    expect(carplayRequestSize({ width: 400, height: 234 }))
      .toEqual({ width: 1280, height: 720 });
    expect(carplayRequestSize({ width: 480, height: 248 }))
      .toEqual({ width: 1280, height: 720 });
  });

  it('always snaps CarPlay and enforces its 720p minimum', () => {
    expect(carplayRequestSize({ width: 800, height: 440 }))
      .toEqual({ width: 1280, height: 720 });
    expect(carplayRequestSize({ width: 1248, height: 491 }))
      .toEqual({ width: 1280, height: 720 });
    expect(carplayRequestSize({ width: 1248, height: 547 }))
      .toEqual({ width: 1280, height: 720 });
    expect(carplayRequestSize({ width: 1280, height: 720 }))
      .toEqual({ width: 1280, height: 720 });
    expect(carplayRequestSize({ width: 1920, height: 1040 }))
      .toEqual({ width: 1920, height: 1080 });
  });
});

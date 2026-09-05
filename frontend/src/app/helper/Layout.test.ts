import { describe, expect, it } from 'vitest';
import { fitInside, isCompactViewport, projectionRequestSize, smallestViewport } from './Layout';

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

  it('requests a supported projection size for compact screens', () => {
    expect(projectionRequestSize({ width: 400, height: 234 }, false))
      .toEqual({ width: 800, height: 480 });
    expect(projectionRequestSize({ width: 480, height: 248 }, false))
      .toEqual({ width: 800, height: 480 });
  });

  it('preserves native projection sizing on larger screens unless snapping is enabled', () => {
    expect(projectionRequestSize({ width: 800, height: 440 }, false))
      .toEqual({ width: 800, height: 440 });
    expect(projectionRequestSize({ width: 800, height: 440 }, true))
      .toEqual({ width: 800, height: 480 });
    expect(projectionRequestSize({ width: 1280, height: 720 }, false))
      .toEqual({ width: 1280, height: 720 });
  });
});

import { describe, expect, it } from 'vitest';

import {
  normalizeMediaAction,
  routeHardwareAction,
  toCarplayMediaCommand,
} from './mediaActions';

describe('media action normalization', () => {
  it.each([
    ['prev', 'previous'],
    ['previous', 'previous'],
    ['play', 'play'],
    ['pause', 'pause'],
    ['playOrPause', 'toggle'],
    ['toggle', 'toggle'],
    ['next', 'next'],
  ] as const)('normalizes %s to %s', (action, expected) => {
    expect(normalizeMediaAction(action)).toBe(expected);
  });

  it('does not classify navigation actions as media actions', () => {
    expect(normalizeMediaAction('left')).toBeNull();
    expect(normalizeMediaAction('selectDown')).toBeNull();
  });

  it.each([
    ['previous', 'prev'],
    ['play', 'play'],
    ['pause', 'pause'],
    ['toggle', 'playOrPause'],
    ['next', 'next'],
  ] as const)('translates canonical %s to CarPlay %s', (action, expected) => {
    expect(toCarplayMediaCommand(action)).toBe(expected);
  });
});

describe('hardware action routing', () => {
  it('routes media actions to the local player even outside the CarPlay page', () => {
    expect(routeHardwareAction('play', 'local', false)).toEqual({
      target: 'local',
      command: 'play',
    });
    expect(routeHardwareAction('pause', 'local', false)).toEqual({
      target: 'local',
      command: 'pause',
    });
    expect(routeHardwareAction('prev', 'local', false)).toEqual({
      target: 'local',
      command: 'previous',
    });
  });

  it('routes normalized media actions to CarPlay when it owns audio', () => {
    expect(routeHardwareAction('previous', 'carplay', false)).toEqual({
      target: 'carplay',
      command: 'prev',
    });
    expect(routeHardwareAction('toggle', 'carplay', false)).toEqual({
      target: 'carplay',
      command: 'playOrPause',
    });
  });

  it('keeps non-media controls scoped to the visible CarPlay page', () => {
    expect(routeHardwareAction('left', 'local', false)).toBeNull();
    expect(routeHardwareAction('left', 'local', true)).toEqual({
      target: 'carplay',
      command: 'left',
    });
  });
});

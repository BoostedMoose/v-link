import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { APP } from '@/store/Store';

vi.mock('@/socket/Namespaces', () => ({
  useNamespaces: () => ({}),
}));

vi.mock('@/app/pages/dashboard/Dashboard', () => ({ default: () => null }));
vi.mock('@/app/pages/music/Music', () => ({ default: () => null }));
vi.mock('@/app/pages/carplay/Carplay', () => ({ default: () => null }));
vi.mock('@/app/pages/rearcam/Rearcam', () => ({ default: () => null }));
vi.mock('@/app/pages/settings/Settings', () => ({ default: () => null }));
vi.mock('@/app/sidebars/NavBar', () => ({ default: () => null }));
vi.mock('@/app/sidebars/SideBar', () => ({ default: () => null }));
vi.mock('@/app/sidebars/TopBar', () => ({ default: () => null }));

import Content from '@/app/Content';

describe('Content page switching', () => {
  afterEach(() => {
    act(() => {
      APP.getState().update((state) => { state.keyStroke = ''; });
    });
  });

  it('handles one page switch only once while the keystroke remains set', () => {
    act(() => {
      APP.getState().update((state) => {
        state.system.startedUp = false;
        state.system.view = 'Music';
        state.keyStroke = '';
        state.switchPage = 'ArrowUp';
        state.pauseKeyBinds = false;
      });
    });
    render(<Content />);

    act(() => {
      APP.getState().update((state) => { state.keyStroke = 'ArrowUp'; });
    });

    expect(APP.getState().system.view).toBe('Carplay');
  });
});

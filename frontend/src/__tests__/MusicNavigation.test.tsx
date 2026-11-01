import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from 'styled-components';

import { createEmptyCarplayMedia } from '@/carplay/mediaState';
import { APP } from '@/store/Store';
import { theme } from '@/theme/Theme';

const { sendCarplayMediaCommand } = vi.hoisted(() => ({
  sendCarplayMediaCommand: vi.fn(),
}));

vi.mock('@/carplay/mediaCommands', () => ({ sendCarplayMediaCommand }));
vi.mock('@/app/pages/music/LocalMediaProvider', () => ({
  useLocalMedia: () => ({
    folderName: 'Local Media',
    tracks: [],
    currentTrack: null,
    error: null,
    playing: false,
    position: 0,
    duration: 0,
    shuffle: false,
    repeatMode: 'off',
    chooseFolder: vi.fn(),
    loadBackendTracks: vi.fn(),
    playTrack: vi.fn(),
    playNext: vi.fn(),
    playPrevious: vi.fn(),
    togglePlayback: vi.fn(),
    toggleShuffle: vi.fn(),
    cycleRepeat: vi.fn(),
  }),
}));
vi.mock('@/app/pages/music/components/UsbMediaBrowser', () => ({ default: () => <div>Media browser</div> }));

import NowPlaying from '@/app/pages/music/components/NowPlaying';
import NativePlayer from '@/app/pages/music/components/NativePlayer';

const pressKey = (code: string) => {
  act(() => { APP.getState().update((state) => { state.keyStroke = code; }); });
  act(() => { APP.getState().update((state) => { state.keyStroke = ''; }); });
};

describe('projected Music navigation', () => {
  beforeEach(() => {
    sendCarplayMediaCommand.mockClear();
    act(() => {
      APP.getState().update((state) => {
        state.keyStroke = '';
        state.pauseKeyBinds = false;
        state.settings.app_bindings = {};
        state.system.windowSize = { width: 480, height: 248 };
        state.system.audioSource = 'carplay';
        state.settings.dongle_bindings = {
          left: { value: 'ArrowLeft' },
          right: { value: 'ArrowRight' },
          down: { value: 'ArrowDown' },
          selectDown: { value: 'Space' },
          back: { value: 'Backspace' },
        };
      });
    });
  });

  afterEach(() => {
    act(() => { APP.getState().update((state) => { state.keyStroke = ''; }); });
  });

  it('uses Left and Right to choose the projected playback command', () => {
    render(
      <ThemeProvider theme={theme}>
        <NowPlaying media={{ ...createEmptyCarplayMedia(), playbackStatus: 1 }} phoneConnected source="CarPlay" />
      </ThemeProvider>,
    );

    pressKey('Space');
    pressKey('ArrowLeft');
    pressKey('Space');
    pressKey('ArrowRight');
    pressKey('ArrowRight');
    pressKey('Space');

    expect(sendCarplayMediaCommand.mock.calls.map(([command]) => command)).toEqual([
      'playOrPause',
      'prev',
      'next',
    ]);
  });

  it('opens local media with confirm when no phone is connected', () => {
    render(
      <ThemeProvider theme={theme}>
        <NowPlaying media={createEmptyCarplayMedia()} phoneConnected={false} source={null} />
      </ThemeProvider>,
    );
    pressKey('Enter');
    expect(screen.getByText('Media browser')).toBeInTheDocument();
  });

  it('navigates all local playback controls with factory-screen bindings', () => {
    act(() => APP.getState().update((state) => {
      state.settings.app_bindings = { left: { value: 'KeyA' }, right: { value: 'KeyD' } };
    }));
    const onToggleShuffle = vi.fn();
    const onPrevious = vi.fn();
    const onPlayPause = vi.fn();
    const onNext = vi.fn();
    const onCycleRepeat = vi.fn();
    const onBrowse = vi.fn();
    render(
      <ThemeProvider theme={theme}>
        <NativePlayer title="Track" folderName="USB" playing position={15} duration={60}
          shuffle={false} repeatMode="off" onToggleShuffle={onToggleShuffle}
          onPrevious={onPrevious} onPlayPause={onPlayPause} onNext={onNext}
          onCycleRepeat={onCycleRepeat} onBrowse={onBrowse} />
      </ThemeProvider>,
    );
    pressKey('Enter');
    pressKey('KeyA');
    pressKey('Space');
    pressKey('KeyA');
    pressKey('NumpadEnter');
    pressKey('KeyA'); // Wrap to repeat.
    pressKey('Space');
    pressKey('KeyA');
    pressKey('Space');
    pressKey('Backspace');
    for (const callback of [onPlayPause, onPrevious, onToggleShuffle, onCycleRepeat, onNext, onBrowse]) {
      expect(callback).toHaveBeenCalledOnce();
    }
  });

  it('ignores the key that opened the player and respects paused key controls', () => {
    const onPlayPause = vi.fn();
    act(() => APP.getState().update((state) => { state.keyStroke = 'Enter'; }));
    render(
      <ThemeProvider theme={theme}>
        <NativePlayer title="Track" folderName="USB" playing position={15} duration={60}
          shuffle={false} repeatMode="off" onToggleShuffle={vi.fn()}
          onPrevious={vi.fn()} onPlayPause={onPlayPause} onNext={vi.fn()}
          onCycleRepeat={vi.fn()} onBrowse={vi.fn()} />
      </ThemeProvider>,
    );
    expect(onPlayPause).not.toHaveBeenCalled();
    act(() => APP.getState().update((state) => { state.keyStroke = ''; state.pauseKeyBinds = true; }));
    pressKey('Enter');
    expect(onPlayPause).not.toHaveBeenCalled();
    act(() => APP.getState().update((state) => { state.pauseKeyBinds = false; }));
    act(() => APP.getState().update((state) => { state.keyStroke = 'Enter'; }));
    expect(onPlayPause).toHaveBeenCalledOnce();
    // Changes to the playback state must not process the same key again.
    act(() => APP.getState().update((state) => { state.system.audioSource = 'local'; }));
    expect(onPlayPause).toHaveBeenCalledOnce();
  });
});

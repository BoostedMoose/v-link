import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from 'styled-components';

import { theme } from '@/theme/Theme';
import { APP, RTI } from '@/store/Store';

const { appEmit, sysEmit } = vi.hoisted(() => ({ appEmit: vi.fn(), sysEmit: vi.fn() }));

vi.mock('@/socket/Namespaces', () => ({
  useNamespaces: () => ({ app: { emit: appEmit }, sys: { emit: sysEmit } }),
}));

import CompactSettings from '@/app/pages/settings/CompactSettings';

const appStore = APP as any;

const renderSettings = () => render(
  <ThemeProvider theme={theme}>
    <CompactSettings />
  </ThemeProvider>,
);

describe('CompactSettings controls', () => {
  beforeEach(() => {
    sysEmit.mockClear();
    appEmit.mockClear();
    appStore.setState((state: any) => ({
      ...state,
      keyStroke: '',
      settings: {
        ...state.settings,
        app_bindings: {
          left: { value: 'ArrowLeft' },
          right: { value: 'ArrowRight' },
        },
        dongle_bindings: {
          selectDown: { value: 'Space' },
          back: { value: 'Backspace' },
        },
        manual_backlight: {
          ui: 'range',
          label: 'Manual Brightness Level',
          value: 8,
          min: 1,
          max: 16,
          step: 1,
        },
        auto_backlight: {
          title: 'Brightness Mode',
          type: 'system',
          autoOpen: { value: true, label: 'Follow Dashboard (requires HS CAN)' },
        },
        constants: { modules: { rti: false } },
      },
      system: { ...state.system, view: 'Settings' },
    }));
    (RTI as any).setState((state: any) => ({
      ...state,
      settings: { commands: { brightness: ['0x20'] } },
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('moves the highlighted tile with the configured left and right controls', () => {
    renderSettings();
    const dashboard = screen.getByRole('button', { name: 'DASHBOARD' });
    const carplay = screen.getByRole('button', { name: 'CARPLAY' });

    expect(dashboard).toHaveAttribute('aria-current', 'true');

    act(() => appStore.setState({ keyStroke: 'ArrowRight' }));
    expect(carplay).toHaveAttribute('aria-current', 'true');

    act(() => appStore.setState({ keyStroke: '' }));
    act(() => appStore.setState({ keyStroke: 'ArrowLeft' }));
    expect(dashboard).toHaveAttribute('aria-current', 'true');
  });

  it('shows a icon on each settings tile', () => {
    renderSettings();

    screen.getAllByRole('button').forEach((button) => {
      expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    });
  });

  it('activates the highlighted tile with Enter', () => {
    renderSettings();

    act(() => appStore.setState({ keyStroke: 'ArrowRight' }));
    act(() => appStore.setState({ keyStroke: '' }));
    act(() => appStore.setState({ keyStroke: 'Enter' }));

    expect(appStore.getState().system.view).toBe('Carplay');
  });

  it('also accepts the configured dongle select binding', () => {
    renderSettings();

    act(() => appStore.setState({ keyStroke: 'ArrowRight' }));
    act(() => appStore.setState({ keyStroke: '' }));
    act(() => appStore.setState({ keyStroke: 'Space' }));

    expect(appStore.getState().system.view).toBe('Carplay');
  });

  it('opens a compact display page and changes brightness with key controls', () => {
    vi.useFakeTimers();
    appStore.getState().update((state: any) => { state.settings.constants.modules.rti = true; });
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'DISPLAY' }));

    expect(screen.getByLabelText('Compact display settings')).toBeInTheDocument();
    expect(screen.getByText('LEVEL 8 / 16')).toBeInTheDocument();

    act(() => appStore.setState({ keyStroke: 'ArrowRight' }));

    expect(screen.getByText('LEVEL 9 / 16')).toBeInTheDocument();
    expect(appStore.getState().settings.manual_backlight.value).toBe(9);
    expect(appStore.getState().settings.auto_backlight.autoOpen.value).toBe(false);
    expect(appEmit).toHaveBeenCalledWith('backlight:update', {
      manual: 9,
      auto_enabled: false,
    });

    act(() => vi.advanceTimersByTime(500));
    expect(appEmit).toHaveBeenCalledWith('save', expect.objectContaining({
      manual_backlight: expect.objectContaining({ value: 9 }),
    }));
  });

  it('does not reuse the confirm keystroke that opened the display page', () => {
    appStore.getState().update((state: any) => { state.settings.constants.modules.rti = true; });
    renderSettings();

    act(() => appStore.setState({ keyStroke: 'ArrowRight' }));
    act(() => appStore.setState({ keyStroke: '' }));
    act(() => appStore.setState({ keyStroke: 'ArrowRight' }));
    act(() => appStore.setState({ keyStroke: '' }));
    act(() => appStore.setState({ keyStroke: 'Space' }));

    expect(screen.getByLabelText('Compact display settings')).toBeInTheDocument();
    expect(appStore.getState().settings.auto_backlight.autoOpen.value).toBe(true);
    expect(appEmit).not.toHaveBeenCalledWith('backlight:update', expect.anything());
  });

  it('toggles automatic brightness with confirm and returns with back', () => {
    appStore.getState().update((state: any) => { state.settings.constants.modules.rti = true; });
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'DISPLAY' }));

    act(() => appStore.setState({ keyStroke: 'Space' }));
    expect(appStore.getState().settings.auto_backlight.autoOpen.value).toBe(false);

    act(() => appStore.setState({ keyStroke: '' }));
    act(() => appStore.setState({ keyStroke: 'Backspace' }));
    expect(screen.getByLabelText('Compact settings')).toBeInTheDocument();
  });

  it('does not render a save button on the compact display page', () => {
    appStore.getState().update((state: any) => { state.settings.constants.modules.rti = true; });
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'DISPLAY' }));

    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });
});

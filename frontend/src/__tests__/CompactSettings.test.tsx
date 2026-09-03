import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from 'styled-components';

import { theme } from '@/theme/Theme';
import { APP } from '@/store/Store';

const { sysEmit } = vi.hoisted(() => ({ sysEmit: vi.fn() }));

vi.mock('@/socket/Namespaces', () => ({
  useNamespaces: () => ({ sys: { emit: sysEmit } }),
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
    appStore.setState((state: any) => ({
      ...state,
      keyStroke: '',
      settings: {
        ...state.settings,
        app_bindings: {
          left: { value: 'ArrowLeft' },
          right: { value: 'ArrowRight' },
        },
        dongle_bindings: { selectDown: { value: 'Space' } },
        constants: { modules: { rti: false } },
      },
      system: { ...state.system, view: 'Settings' },
    }));
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
});

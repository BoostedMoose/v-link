import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ThemeProvider } from 'styled-components';
import { theme } from '@/theme/Theme';

const { emit } = vi.hoisted(() => ({ emit: vi.fn() }));
vi.mock('@/socket/Namespaces', () => ({
  useNamespaces: () => ({ sys: { timeout: () => ({ emit }) } }),
}));
vi.mock('@/app/components/Modal', () => ({ openModal: vi.fn() }));

import ReleaseChooser from './ReleaseChooser';

const releases = [
  { id: 1, tag: 'v3.1.0', name: 'Stable', prerelease: false, branch: 'stable', published_at: '2026-09-19' },
  { id: 2, tag: 'v3.2.0-dev.2', name: 'Dev 2', prerelease: true, branch: 'dev', published_at: '2026-09-18' },
  { id: 3, tag: 'v3.2.0-factory.2', name: 'Factory 2', prerelease: true, branch: 'factory-screen', published_at: '2026-09-17' },
  { id: 4, tag: 'v3.2.0-factory.1', name: 'Factory 1', prerelease: true, branch: 'factory-screen', published_at: '2026-09-16' },
];

afterEach(() => { vi.unstubAllGlobals(); emit.mockClear(); });

it('lets the user choose an older prerelease from a specific branch', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    json: async () => url.endsWith('/api/releases')
      ? { releases, installed: { tag: 'v3.1.0', branch: 'stable', commit: 'a'.repeat(40) }, truncated: false }
      : { commit: 'b'.repeat(40) },
  })));

  render(<ThemeProvider theme={theme}><ReleaseChooser currentVersion="v3.1.0" /></ThemeProvider>);
  fireEvent.change(await screen.findByLabelText('Release channel'), { target: { value: 'prerelease' } });
  fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'factory-screen' } });
  fireEvent.change(screen.getByLabelText('Release (newest first)'), { target: { value: '4' } });

  await waitFor(() => expect(screen.getByText(/Release commit: bbbbbbbbbbbb/)).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Install selected release' }));
  expect(emit).toHaveBeenCalledWith('systemTask', 'update', { release_id: 4 }, expect.any(Function));
});

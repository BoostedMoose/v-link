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
      ? { releases, installed: { tag: 'v3.1.0', branch: 'stable', commit: 'a'.repeat(40), prerelease: false }, truncated: false }
      : { commit: 'b'.repeat(40) },
  })));

  render(<ThemeProvider theme={theme}><ReleaseChooser currentVersion="v3.1.0" /></ThemeProvider>);
  const channel = await screen.findByLabelText('Release channel');
  expect(screen.getByText('Installed: v3.1.0')).toBeInTheDocument();
  expect(screen.queryByText(/Commit:/)).not.toBeInTheDocument();
  fireEvent.change(channel, { target: { value: 'prerelease' } });
  fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'factory-screen' } });
  fireEvent.change(screen.getByLabelText('Release (newest first)'), { target: { value: '4' } });

  await waitFor(() => expect(screen.getByText('Commit: bbbbbbb')).toBeInTheDocument());
  expect(document.body.textContent).not.toContain('b'.repeat(40));
  fireEvent.click(screen.getByRole('button', { name: 'Install selected release' }));
  expect(emit).toHaveBeenCalledWith('systemTask', 'update', { release_id: 4 }, expect.any(Function));
});

it('shows only a short installed hash for a prerelease', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    json: async () => url.endsWith('/api/releases')
      ? { releases, installed: { tag: 'v3.2.0-dev.1', branch: 'dev', commit: 'f345688450b636298c5bb0af76c2fbb2349168ee', prerelease: true }, truncated: false }
      : { commit: 'b'.repeat(40) },
  })));

  render(<ThemeProvider theme={theme}><ReleaseChooser currentVersion="v3.1.0" /></ThemeProvider>);
  expect(await screen.findByText('Installed: v3.2.0-dev.1 · f345688')).toBeInTheDocument();
  expect(document.body.textContent).not.toContain('f345688450b636298c5bb0af76c2fbb2349168ee');
});

it('offers a retry when the release list cannot be loaded', async () => {
  const fetchMock = vi.fn()
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValue({
      ok: true,
      json: async () => ({ releases, installed: { tag: 'v3.1.0', branch: 'stable', commit: 'a'.repeat(40), prerelease: false }, truncated: false }),
    });
  vi.stubGlobal('fetch', fetchMock);

  render(<ThemeProvider theme={theme}><ReleaseChooser currentVersion="v3.1.0" /></ThemeProvider>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load releases');
  expect(screen.queryByLabelText('Release channel')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByLabelText('Release channel')).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(3); // Retry loads the list, then resolves the selected tag.
});

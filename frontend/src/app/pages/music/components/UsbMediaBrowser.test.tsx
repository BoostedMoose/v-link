import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from 'styled-components'

import { theme } from '@/theme/Theme'

const localMedia = vi.hoisted(() => ({
  folderName: 'Native folder',
  tracks: [{ name: 'Native track.mp3', url: 'blob:native-track' }],
  currentTrack: null,
  error: null,
  playing: false,
  chooseFolder: vi.fn().mockResolvedValue(true),
  loadBackendTracks: vi.fn(),
  playTrack: vi.fn(),
}))

vi.mock('../LocalMediaProvider', () => ({
  useLocalMedia: () => localMedia,
}))

import UsbMediaBrowser from './UsbMediaBrowser'

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView

describe('USB media browser source selection', () => {
  beforeEach(() => {
    localMedia.chooseFolder.mockClear()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ name: 'USB drive', path: '/media/usb' }],
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    if (originalScrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        value: originalScrollIntoView,
      })
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    }
  })

  it('shows native tracks after choosing a browser folder', async () => {
    render(
      <ThemeProvider theme={theme}>
        <UsbMediaBrowser onClose={vi.fn()} onTrackSelected={vi.fn()} />
      </ThemeProvider>,
    )

    expect(await screen.findByText('USB drive')).toBeInTheDocument()
    expect(screen.queryByText('Native track')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Choose folder' }))

    expect(await screen.findByText('Native track')).toBeInTheDocument()
    expect(localMedia.chooseFolder).toHaveBeenCalledOnce()
  })
})

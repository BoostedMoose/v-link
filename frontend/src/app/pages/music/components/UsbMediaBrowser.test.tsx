import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from 'styled-components'

import { theme } from '@/theme/Theme'
import { APP } from '@/store/Store'

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
    localMedia.loadBackendTracks.mockClear()
    APP.getState().update((state) => {
      state.keyStroke = ''
      state.pauseKeyBinds = false
      state.settings.app_bindings = { left: { value: 'KeyA' }, right: { value: 'KeyD' } }
      state.settings.dongle_bindings = { selectDown: { value: 'Space' }, back: { value: 'Backspace' } }
    })
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

  it('browses folders, scrolls selected files into view, and plays using key controls', async () => {
    const files = Array.from({ length: 12 }, (_, index) => ({
      name: `Track ${index}.mp3`, path: `/media/usb/album/${index}.mp3`, kind: 'file',
    }))
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => url.endsWith('/roots')
        ? [{ name: 'USB drive', path: '/media/usb' }]
        : url.includes(encodeURIComponent('/media/usb/album'))
          ? { name: 'Album', path: '/media/usb/album', entries: files }
          : { name: 'USB drive', path: '/media/usb', entries: [{ name: 'Album', path: '/media/usb/album', kind: 'directory' }] },
    })))
    const onClose = vi.fn()
    const onTrackSelected = vi.fn()
    // Simulate the confirm stroke that opened this screen.
    APP.getState().update((state) => { state.keyStroke = 'Space' })
    render(
      <ThemeProvider theme={theme}>
        <UsbMediaBrowser onClose={onClose} onTrackSelected={onTrackSelected} />
      </ThemeProvider>,
    )
    expect(await screen.findByText('USB drive')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(1)
    const pressKey = (key: string) => {
      act(() => APP.getState().update((state) => { state.keyStroke = '' }))
      act(() => APP.getState().update((state) => { state.keyStroke = key }))
    }
    pressKey('Space')
    expect(await screen.findByRole('button', { name: /Album/ })).toBeInTheDocument()
    pressKey('Enter')
    expect(await screen.findByText('Track 0')).toBeInTheDocument()
    pressKey('KeyA') // Wrap to the last file.
    const lastFile = screen.getByRole('button', { name: /Track 11/ })
    await waitFor(() => expect(HTMLElement.prototype.scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' }))
    expect(vi.mocked(HTMLElement.prototype.scrollIntoView).mock.contexts.at(-1)).toBe(lastFile)
    pressKey('Enter')
    expect(localMedia.loadBackendTracks).toHaveBeenCalledWith('Album', files, 11)
    expect(onTrackSelected).toHaveBeenCalledOnce()

    pressKey('Backspace')
    expect(await screen.findByRole('button', { name: /Album/ })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    pressKey('Backspace')
    expect(await screen.findByText('Media locations')).toBeInTheDocument()
    pressKey('Backspace')
    expect(onClose).toHaveBeenCalledOnce()
  })
})

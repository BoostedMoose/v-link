import { act, cleanup, render } from '@testing-library/react'
import { ThemeProvider } from 'styled-components'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { theme } from '@/theme/Theme'
import { APP } from '@/store/Store'
import Carplay from './Carplay'

const mocks = vi.hoisted(() => ({ findDevice: vi.fn(), recover: vi.fn(), healthy: vi.fn() }))
vi.mock('node-carplay/web', () => ({
  findDevice: mocks.findDevice, requestDevice: vi.fn(), CommandMapping: {},
}))
vi.mock('./useCarplayAudio', () => {
  const audio = Object.fromEntries([
    'processAudio', 'getAudioPlayer', 'resetAudioRouting', 'startRecording', 'stopRecording',
  ].map(key => [key, vi.fn()]))
  return { default: () => audio }
})
vi.mock('./useCarplayTouch', () => ({ useCarplayTouch: () => vi.fn() }))
vi.mock('@/socket/Namespaces', () => {
  const socket = { log: { emit: vi.fn() } }
  return { useNamespaces: () => socket }
})

class TestWorker {
  static instances: TestWorker[] = []
  postMessage = vi.fn<(message: { type: string }, transfer?: unknown[]) => void>()
  terminate = vi.fn()
  onmessage: ((event: { data: object }) => void) | null = null
  constructor() { TestWorker.instances.push(this) }
}
class TestChannel {
  static instances: TestChannel[] = []
  port1 = { close: vi.fn() }
  port2 = { close: vi.fn() }
  constructor() { TestChannel.instances.push(this) }
}

const mount = () => render(<ThemeProvider theme={theme}>
  <Carplay command="" commandCounter={0} onRecovery={mocks.recover} onHealthy={mocks.healthy} />
</ThemeProvider>)

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  TestWorker.instances = []
  TestChannel.instances = []
  vi.stubGlobal('Worker', TestWorker)
  vi.stubGlobal('MessageChannel', TestChannel)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  Object.defineProperty(navigator, 'usb', { configurable: true, value: {} })
  Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', {
    configurable: true, value: vi.fn(() => ({})),
  })
  mocks.findDevice.mockResolvedValue(null)
  APP.getState().update(state => {
    state.system.carplay.phase = 'idle'
    state.system.carplay.dongle = false
    state.system.carplay.worker = false
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it('terminates both workers, closes ports and transfers a fresh canvas on remount', async () => {
  const first = mount()
  await act(async () => {})
  expect(TestWorker.instances).toHaveLength(2)
  first.unmount()
  for (const worker of TestWorker.instances) expect(worker.terminate).toHaveBeenCalledOnce()
  for (const channel of TestChannel.instances) {
    expect(channel.port1.close).toHaveBeenCalledOnce()
    expect(channel.port2.close).toHaveBeenCalledOnce()
  }
  mount()
  await act(async () => {})
  expect(TestWorker.instances).toHaveLength(4)
  expect(TestChannel.instances).toHaveLength(4)
  expect(HTMLCanvasElement.prototype.transferControlToOffscreen).toHaveBeenCalledTimes(2)
})

it('ignores device discovery completing after teardown', async () => {
  let resolve!: (device: object) => void
  mocks.findDevice.mockReturnValue(new Promise(done => { resolve = done }))
  const result = mount()
  const usbWorker = TestWorker.instances[0]
  result.unmount()
  await act(async () => { resolve({}) })
  expect(usbWorker.postMessage.mock.calls.some(([message]) => message.type === 'start')).toBe(false)
})

it('does not replenish recovery from one valid packet followed by failure', async () => {
  mount()
  await act(async () => {})
  const usbWorker = TestWorker.instances[0]
  act(() => {
    usbWorker.onmessage?.({ data: { type: 'driverHealthy' } })
    usbWorker.onmessage?.({ data: { type: 'failure', message: 'Read failed' } })
  })
  act(() => { vi.advanceTimersByTime(30000) })
  expect(mocks.healthy).not.toHaveBeenCalled()
  expect(mocks.recover).toHaveBeenCalledOnce()
  expect(usbWorker.terminate).toHaveBeenCalledOnce()
  expect(APP.getState().system.carplay.error).toBe('Read failed')
})

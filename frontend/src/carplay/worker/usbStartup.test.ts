import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetUsbSession } from './usbStartup'

function device() {
  return {
    opened: false,
    open: vi.fn(async function (this: { opened: boolean }) { this.opened = true }),
    close: vi.fn(async function (this: { opened: boolean }) { this.opened = false }),
    reset: vi.fn(async () => {}),
  }
}

afterEach(() => vi.useRealTimers())

describe('fresh USB session startup', () => {
  it('resets and closes the handle before the driver begins reading', async () => {
    const usb = device()
    expect(await resetUsbSession(async () => usb)).toBe(usb)
    expect(usb.reset).toHaveBeenCalledOnce()
    expect(usb.close).toHaveBeenCalledOnce()
    expect(usb.opened).toBe(false)
  })

  it('waits for re-enumeration without repeatedly resetting the replacement', async () => {
    vi.useFakeTimers()
    const old = device()
    old.reset.mockRejectedValue(new DOMException('Device disconnected', 'NetworkError'))
    const replacement = device()
    const find = vi.fn().mockResolvedValueOnce(old).mockResolvedValueOnce(null).mockResolvedValue(replacement)
    const result = resetUsbSession(find)
    await vi.runAllTimersAsync()
    expect(await result).toBe(replacement)
    expect(old.reset).toHaveBeenCalledOnce()
    expect(replacement.reset).not.toHaveBeenCalled()
    expect(replacement.close).toHaveBeenCalledOnce()
  })

  it('waits for the terminated worker to release ownership before resetting', async () => {
    vi.useFakeTimers()
    const usb = device()
    usb.open.mockRejectedValueOnce(new DOMException('Busy', 'NetworkError'))
    const result = resetUsbSession(async () => usb)
    await vi.runAllTimersAsync()
    expect(await result).toBe(usb)
    expect(usb.open).toHaveBeenCalledTimes(2)
    expect(usb.reset).toHaveBeenCalledOnce()
  })

  it('bounds waiting for a dongle that does not return', async () => {
    vi.useFakeTimers()
    const result = expect(resetUsbSession(async () => null, 1000)).rejects.toThrow('not available')
    await vi.runAllTimersAsync()
    await result
  })

  it('preserves permission errors without retrying', async () => {
    const usb = device()
    usb.open.mockRejectedValue(new DOMException('Access denied', 'SecurityError'))
    await expect(resetUsbSession(async () => usb)).rejects.toThrow('Access denied')
    expect(usb.open).toHaveBeenCalledOnce()
    expect(usb.reset).not.toHaveBeenCalled()
  })
})

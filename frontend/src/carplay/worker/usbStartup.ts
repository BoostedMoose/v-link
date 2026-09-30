type UsbDevice = Pick<USBDevice, 'open' | 'close' | 'reset' | 'opened'>

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/** Called only in a new worker, before the driver's transferIn loop exists. */
export async function resetUsbSession<T extends UsbDevice>(
  findDevice: () => Promise<T | null>,
  timeoutMs = 15000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let resetIssued = false
  let lastError: unknown = new Error('Carlinkit dongle is not available')

  do {
    const device = await findDevice()
    if (device) {
      try {
        await device.open()
        if (!resetIssued) {
          // A reset may detach and re-enumerate the dongle. Never reset the
          // replacement a second time while waiting for it to become available.
          resetIssued = true
          await device.reset()
        }
        return device
      } catch (error) {
        lastError = error
        const name = (error as { name?: string })?.name
        if (name !== 'NetworkError' && name !== 'NotFoundError' && name !== 'InvalidStateError') {
          throw error
        }
      } finally {
        if (device.opened) {
          try { await device.close() } catch { /* Device may have detached. */ }
        }
      }
    }
    await delay(250)
  } while (Date.now() < deadline)

  throw lastError
}

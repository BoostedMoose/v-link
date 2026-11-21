import { describe, expect, it } from 'vitest'

import { summarizeUsbDevice, summarizeUsbDevices } from './usbDeviceSummary'

const device = (overrides: Partial<USBDevice> = {}) => ({
  configuration: null,
  manufacturerName: 'Acme',
  opened: false,
  productId: 0x1520,
  productName: 'Projection Dongle',
  serialNumber: null,
  vendorId: 0x1314,
  ...overrides,
}) as USBDevice

describe('USB device summaries', () => {
  it('includes the human-readable name and hexadecimal USB IDs', () => {
    expect(summarizeUsbDevice(device())).toBe(
      'Acme Projection Dongle (VID:PID=0x1314:0x1520, opened=false, configuration=none)',
    )
  })

  it('includes optional configuration and serial details', () => {
    expect(summarizeUsbDevice(device({
      configuration: {
        configurationName: 'CarPlay',
        configurationValue: 1,
      } as USBConfiguration,
      opened: true,
      serialNumber: 'ABC123',
    }))).toContain('opened=true, configuration=1 (CarPlay), serial=ABC123')
  })

  it('summarizes multiple authorized devices without object coercion', () => {
    expect(summarizeUsbDevices([
      device(),
      device({ manufacturerName: null, productName: null, productId: 2 }),
    ])).toBe(
      '2 authorized devices: Acme Projection Dongle (VID:PID=0x1314:0x1520, opened=false, configuration=none); Unknown USB device (VID:PID=0x1314:0x0002, opened=false, configuration=none)',
    )
  })
})

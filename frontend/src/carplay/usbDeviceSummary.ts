type UsbDeviceSummarySource = Pick<
  USBDevice,
  | 'configuration'
  | 'manufacturerName'
  | 'opened'
  | 'productId'
  | 'productName'
  | 'serialNumber'
  | 'vendorId'
>

const formatUsbId = (value: number) => `0x${value.toString(16).padStart(4, '0')}`

export const summarizeUsbDevice = (device: UsbDeviceSummarySource) => {
  const displayName = [device.manufacturerName, device.productName]
    .filter((value): value is string => Boolean(value))
    .join(' ') || 'Unknown USB device'
  const configuration = device.configuration
    ? `${device.configuration.configurationValue}${device.configuration.configurationName
      ? ` (${device.configuration.configurationName})`
      : ''}`
    : 'none'
  const serial = device.serialNumber ? `, serial=${device.serialNumber}` : ''

  return `${displayName} (VID:PID=${formatUsbId(device.vendorId)}:${formatUsbId(device.productId)}, opened=${device.opened}, configuration=${configuration}${serial})`
}

export const summarizeUsbDevices = (devices: readonly UsbDeviceSummarySource[]) => {
  const label = devices.length === 1 ? 'device' : 'devices'
  return `${devices.length} authorized ${label}: ${devices.map(summarizeUsbDevice).join('; ')}`
}

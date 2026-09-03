import CarplayWeb, {
  CarplayMessage,
  DongleConfig,
  SendAudio,
  SendCommand,
  SendTouch,
  PhoneType,
  Plugged,
  findDevice,
} from 'node-carplay/web'
import { AudioPlayerKey, Command, KeyCommand } from "./types";
import { RenderEvent, ResetEvent } from './render/RenderEvents'
import { RingBuffer } from 'ringbuf.js'
import { createAudioPlayerKey } from './utils'

//This shouldn't be here, try to fix vite.config.ts.....
import { Buffer } from 'buffer';
self.Buffer = Buffer;

const diagnosticPrefixes = [
  '[CarPlay] BoxSettings:',
  '[CarPlay Dongle] BoxInfo:',
  '[CarPlay Dongle] Firmware:',
  '[CarPlay USB]',
]
const workerConsoleInfo = console.info.bind(console)

console.info = (...args: unknown[]) => {
  workerConsoleInfo(...args)

  if (typeof args[0] !== 'string' || !diagnosticPrefixes.includes(args[0])) return

  const message = args.map(value => {
    if (typeof value === 'string') return value

    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }).join(' ')

  postMessage({ type: 'diagnostic', message })
}

let carplayWeb: CarplayWeb | null = null
let videoPort: MessagePort | null = null
let microphonePort: MessagePort | null = null
let config: Partial<DongleConfig> | null = null
const audioBuffers: Record<AudioPlayerKey, RingBuffer<Int16Array>> = {}
const pendingAudio: Record<AudioPlayerKey, Int16Array[]> = {}
const MAX_PENDING_AUDIO_FRAMES = 8
let lifecycle: Promise<void> = Promise.resolve()
let videoMessageCount = 0

const clearAudioState = () => {
  Object.keys(audioBuffers).forEach(key => delete audioBuffers[key as AudioPlayerKey])
  Object.keys(pendingAudio).forEach(key => delete pendingAudio[key as AudioPlayerKey])
}

const isolatedArrayBuffer = (data: Uint8Array): ArrayBuffer => {
  // Buffer/Uint8Array payloads can be views into a larger USB transfer. Moving
  // that backing buffer to the renderer would detach data still owned by the
  // dongle parser, so only transfer an isolated copy.
  // Buffer.slice() returns a view rather than a copy, and its `.buffer` loses
  // the Buffer's byteOffset/byteLength. Copy explicitly so the renderer sees
  // exactly one H.264 payload and nothing around it.
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  return copy.buffer
}

const stopProjection = async () => {
  const current = carplayWeb
  carplayWeb = null
  clearAudioState()
  videoMessageCount = 0
  videoPort?.postMessage(new ResetEvent())
  await current?.stop()
}

const withoutUsbReset = async <T>(device: USBDevice, operation: () => Promise<T>): Promise<T> => {
  const ownReset = Object.getOwnPropertyDescriptor(device, 'reset')
  let patched = false

  try {
    Object.defineProperty(device, 'reset', {
      configurable: true,
      value: async () => undefined,
    })
    patched = true
    console.debug('(CarPlay) Suppressing node-carplay WebUSB reset')
  } catch {
    console.warn('(CarPlay) Unable to suppress node-carplay WebUSB reset')
  }

  try {
    return await operation()
  } finally {
    if (patched) {
      if (ownReset) Object.defineProperty(device, 'reset', ownReset)
      else Reflect.deleteProperty(device, 'reset')
    }
  }
}

const startProjection = async (nextConfig: Partial<DongleConfig>) => {
  if (carplayWeb) return

  clearAudioState()
  videoMessageCount = 0
  config = nextConfig
  const device = await findDevice()
  if (!device) throw new Error('Carlinkit dongle is not available')

  const next = new CarplayWeb(config)
  carplayWeb = next
  next.onmessage = handleMessage
  next.dongleDriver.on('message', message => {
    if (!(message instanceof Plugged)) return

    const source = message.phoneType === PhoneType.AndroidAuto || message.phoneType === PhoneType.AndroidMirror
      ? 'Android Auto'
      : 'CarPlay'
    postMessage({ type: 'projectionSource', source })
  })

  try {
    await withoutUsbReset(device, () => next.start(device))
    postMessage({ type: 'workerStarted' })
  } catch (error) {
    if (carplayWeb === next) carplayWeb = null
    try {
      await next.stop()
    } catch {
      // Preserve the original startup error.
    }
    throw error
  }
}

const runLifecycle = (operation: () => Promise<void>) => {
  lifecycle = lifecycle.then(operation, operation).catch(error => {
    postMessage({
      type: 'failure',
      message: error instanceof Error ? error.message : String(error),
    })
  })
}

const handleMessage = (message: CarplayMessage) => {
  if (carplayWeb) {
    const driver = carplayWeb.dongleDriver as unknown as { errorCount?: number }
    if (typeof driver.errorCount === 'number') driver.errorCount = 0
  }

  const { type, message: payload } = message
  if (type === 'video' && videoPort) {
    videoMessageCount++
    if (videoMessageCount === 1 || videoMessageCount === 30) {
      postMessage({
        type: 'videoStats',
        count: videoMessageCount,
        bytes: payload.data.byteLength,
      })
    }
    const buffer = isolatedArrayBuffer(payload.data as Uint8Array)
    videoPort.postMessage(new RenderEvent(buffer), [buffer])
  } else if (type === 'audio' && payload.data) {
    const { decodeType, audioType } = payload
    const audioKey = createAudioPlayerKey(decodeType, audioType)
    if (audioBuffers[audioKey]) {
      try {
        audioBuffers[audioKey].push(payload.data)
      } catch {
        // Drop audio frames when the ring buffer cannot accept more data.
      }
    } else {
      if (!pendingAudio[audioKey]) {
        pendingAudio[audioKey] = []
      }
      if (pendingAudio[audioKey].length < MAX_PENDING_AUDIO_FRAMES) {
        pendingAudio[audioKey].push(payload.data)
        payload.data = undefined

        postMessage({
          type: 'requestBuffer',
          message: { ...payload },
        })
      }
    }
  } else {
    postMessage(message)
  }
}

onmessage = async (event: MessageEvent<Command>) => {
  switch (event.data.type) {
    case 'initialise':
      if (carplayWeb) return
      videoPort = event.data.payload.videoPort
      microphonePort = event.data.payload.microphonePort
      microphonePort.onmessage = ev => {
        if (carplayWeb) {
          const data = new SendAudio(ev.data)
          carplayWeb.dongleDriver.send(data)
        }
      }
      break
    case 'audioBuffer':
      const { sab, decodeType, audioType } = event.data.payload
      const audioKey = createAudioPlayerKey(decodeType, audioType)
      audioBuffers[audioKey] = new RingBuffer(sab, Int16Array)
      if (pendingAudio[audioKey]) {
        pendingAudio[audioKey].forEach(buf => {
          audioBuffers[audioKey].push(buf)
        })
        pendingAudio[audioKey] = []
      }
      break
    case 'start':
      const { config: startConfig } = event.data.payload
      runLifecycle(() => startProjection(startConfig))
      break
    case 'touch':
      if (config && carplayWeb) {
        const { x, y, action } = event.data.payload
        const data = new SendTouch(x, y, action)
        carplayWeb.dongleDriver.send(data)
      }
      break
    case 'stop':
      runLifecycle(stopProjection)
      break
    case 'frame':
      if (carplayWeb) {
        const data = new SendCommand('frame')
        carplayWeb.dongleDriver.send(data)
      }
      break
    case 'keyCommand':
      const command: KeyCommand = event.data.command
      const data = new SendCommand(command as ConstructorParameters<typeof SendCommand>[0])
      if (carplayWeb) {
        carplayWeb.dongleDriver.send(data)
      }
  }
}

export { }

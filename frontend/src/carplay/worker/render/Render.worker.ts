// Based on https://github.com/codewithpassion/foxglove-studio-h264-extension/tree/main
// MIT License
import { getDecoderConfig, isKeyFrame } from './lib/utils'
import { InitEvent, RenderEvent, WorkerEvent } from './RenderEvents'
import { Canvas2DRenderer } from './Canvas2DRenderer'
import { WebGL2Renderer } from './WebGL2Renderer'
import { WebGLRenderer } from './WebGLRenderer'
import { WebGPURenderer } from './WebGPURenderer'
import { useNamespaces } from '@/socket/Namespaces'

export interface FrameRenderer {
  draw(data: VideoFrame): void
}

// eslint-disable-next-line no-restricted-globals
const scope = self as unknown as Worker
const socket = useNamespaces();

type HostType = Window & typeof globalThis

export class RenderWorker {
  constructor(private host: HostType) {}

  private renderer: FrameRenderer | null = null
  private videoPort: MessagePort | null = null
  private pendingFrame: VideoFrame | null = null
  private startTime: number | null = null
  private frameCount = 0
  private timestamp = 0
  private fps = 0
  private decoderConfig: VideoDecoderConfig | null = null
  private streamStarted = false

  private onVideoDecoderOutput = (frame: VideoFrame) => {
    // Update statistics.
    if (this.startTime == null) {
      this.startTime = performance.now()
    } else {
      const elapsed = (performance.now() - this.startTime) / 1000
      this.fps = ++this.frameCount / elapsed
    }

    if (!this.streamStarted) {
      this.streamStarted = true
      scope.postMessage({
        type: 'streamStarted',
        config: this.decoderConfig,
        displayWidth: frame.displayWidth,
        displayHeight: frame.displayHeight,
      })
    }

    // Schedule the frame to be rendered.
    this.renderFrame(frame)
  }

  private renderFrame = (frame: VideoFrame) => {
    if (!this.pendingFrame) {
      // Schedule rendering in the next animation frame.
      requestAnimationFrame(this.renderAnimationFrame)
    } else {
      // Close the current pending frame before replacing it.
      this.pendingFrame.close()
    }
    // Set or replace the pending frame.
    this.pendingFrame = frame
  }

  private renderAnimationFrame = () => {
    if (this.pendingFrame) {
      this.renderer?.draw(this.pendingFrame)
      this.pendingFrame = null
    }
  }

  private onVideoDecoderOutputError = (err: Error) => {
    console.error(`H264 Render worker decoder error`, err)
    socket.log.emit('error', `(CarPlay) H264 Render worker decoder error: ${err}`)
    this.resetDecoder('decoder error')
  }

  private createDecoder = () => new VideoDecoder({
      output: this.onVideoDecoderOutput,
      error: this.onVideoDecoderOutputError,
    })

  private decoder = this.createDecoder()

  private resetDecoder = (reason: string) => {
    try {
      this.decoder.close()
    } catch {
      // A decoder error may already have closed it.
    }
    this.pendingFrame?.close()
    this.pendingFrame = null
    this.decoder = this.createDecoder()
    this.decoderConfig = null
    this.streamStarted = false
    this.timestamp = 0
    this.frameCount2 = 0
    socket.log.emit('debug', `(CarPlay) Decoder reset: ${reason}`)
  }

  private configChanged = (next: VideoDecoderConfig) =>
    !this.decoderConfig ||
    this.decoderConfig.codec !== next.codec ||
    this.decoderConfig.codedWidth !== next.codedWidth ||
    this.decoderConfig.codedHeight !== next.codedHeight

  init = (event: InitEvent) => {
    socket.log.emit('debug', `(CarPlay) Render worker init received, renderer: ${event.renderer}`)
    const candidates: Array<[string, () => FrameRenderer]> = [
      ['webgl',   () => new WebGLRenderer(event.canvas)],
      ['webgl2',  () => new WebGL2Renderer(event.canvas)],
      // ['webgpu',  () => new WebGPURenderer(event.canvas)],
      ['canvas2d', () => new Canvas2DRenderer(event.canvas)],
    ]
    for (const [name, create] of candidates) {
      try {
        this.renderer = create()
        socket.log.emit('debug', `(CarPlay) Renderer initialized: ${name}`)
        break
      } catch (e) {
        socket.log.emit('error', `(CarPlay) Renderer init failed (${name}): ${e}`)
      }
    }
    this.videoPort = event.videoPort
    this.videoPort.onmessage = ev => {
      const message = ev.data as WorkerEvent
      if (message.type === 'reset') {
        this.resetDecoder('projection session stopped')
      } else {
        this.onFrame(message as RenderEvent)
      }
    }
    socket.log.emit('debug', '(CarPlay) Render worker videoPort ready')

    if (event.reportFps) {
      setInterval(() => {
        if (this.decoder.state === 'configured') {
          console.debug(`FPS: ${this.fps}`)
        }
      }, 5000)
    }
  }

  private frameCount2 = 0

  onFrame = (event: RenderEvent) => {
    this.frameCount2++
    if (this.frameCount2 === 1) {
      console.log(`(CarPlay) First renderer frame received: ${event.frameData.byteLength} bytes`)
      socket.log.emit('debug', `(CarPlay) First video frame received, decoder state: ${this.decoder.state}`)
    }
    const frameData = new Uint8Array(event.frameData)

    const decoderConfig = getDecoderConfig(frameData)
    if (decoderConfig && this.configChanged(decoderConfig)) {
      if (this.decoder.state !== 'unconfigured') this.resetDecoder('stream configuration changed')
      try {
        this.decoder.configure(decoderConfig)
        this.decoderConfig = decoderConfig
        const { codec, codedWidth, codedHeight } = decoderConfig
        console.log(`(CarPlay) Decoder-config: codec=${codec} ${codedWidth}x${codedHeight}`);
        socket.log.emit('debug', `(CarPlay) Decoder-config: codec=${codec} ${codedWidth}x${codedHeight}`)
      } catch (error) {
        socket.log.emit('error', `(CarPlay) Decoder configure failed: ${error}`)
        this.resetDecoder('configuration failed')
      }
    }
    if (this.decoder.state === 'configured') {
      try {
        this.decoder.decode(
          new EncodedVideoChunk({
            type: isKeyFrame(frameData) ? 'key' : 'delta',
            data: frameData,
            timestamp: this.timestamp++,
          }),
        )
      } catch (e) {
        console.error(`H264 Render Worker decode error`, e)
        socket.log.emit('error', `(CarPlay) H264 Render worker decoder error: ${e}`)
        this.resetDecoder('decode failed')
      }
    }
  }
}

// eslint-disable-next-line no-restricted-globals
const worker = new RenderWorker(self)
scope.addEventListener('message', (event: MessageEvent<WorkerEvent>) => {
  if (event.data.type === 'init') {
    worker.init(event.data as InitEvent)
  }
})

export {}

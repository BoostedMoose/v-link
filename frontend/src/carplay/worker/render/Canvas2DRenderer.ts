import { FrameRenderer } from './Render.worker'

export class Canvas2DRenderer implements FrameRenderer {
  #ctx: OffscreenCanvasRenderingContext2D

  constructor(canvas: OffscreenCanvas) {
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw Error('2D canvas context is null')
    }
    this.#ctx = ctx
  }

  draw(frame: VideoFrame): void {
    if (this.#ctx.canvas.width !== frame.displayWidth ||
        this.#ctx.canvas.height !== frame.displayHeight) {
      this.#ctx.canvas.width  = frame.displayWidth
      this.#ctx.canvas.height = frame.displayHeight
    }
    this.#ctx.drawImage(frame as unknown as CanvasImageSource, 0, 0)
    frame.close()
  }
}

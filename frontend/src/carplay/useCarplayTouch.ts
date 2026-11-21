import { useRef, useCallback } from 'react'
import { TouchAction } from 'node-carplay/web'
import { CarPlayWorker } from './worker/types'

export const useCarplayTouch = (worker: CarPlayWorker) => {
  const pointerDownRef = useRef(false)

  const sendTouchEvent: React.PointerEventHandler<HTMLDivElement> = useCallback(
    e => {
      let action = TouchAction.Up
      if (e.type === 'pointerdown') {
        action = TouchAction.Down
        pointerDownRef.current = true
        ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
      } else if (pointerDownRef.current) {
        switch (e.type) {
          case 'pointermove':
            action = TouchAction.Move
            break
          case 'pointerup':
          case 'pointercancel':
            pointerDownRef.current = false
            action = TouchAction.Up
            break
          default:
            return
        }
      } else {
        return
      }

      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      worker.postMessage({
        type: 'touch',
        payload: { x: x / rect.width, y: y / rect.height, action },
      })
    },
    [worker],
  )

  return sendTouchEvent
}
import { useCallback, useEffect, useRef, useState } from 'react'
import { APP } from '@/store/Store'
import { useNamespaces } from '@/socket/Namespaces'
import { createEmptyCarplayMedia } from './mediaState'
import { transitionProjectionSession } from './sessionState'
import Carplay from './Carplay'

const MAX_RECOVERIES = 2
export const USB_RELEASE_DELAY_MS = 500

/** Owns the projection lifetime independently of the dashboard and hardware. */
export default function ProjectionRuntime(props: { command: string; commandCounter: number }) {
  const socket = useNamespaces()
  const [runtime, setRuntime] = useState(0)
  const [running, setRunning] = useState(true)
  const restarting = useRef(false)
  const attempts = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const recover = useCallback(() => {
    if (restarting.current) return
    if (++attempts.current > MAX_RECOVERIES) {
      socket.log.emit('error', '(CarPlay) Automatic recovery stopped; use Restart to try again')
      return
    }

    restarting.current = true
    setRunning(false)
    // Unmount terminates the USB worker (including its pending read), renderer,
    // microphone and audio players. Allow Chromium to release the USB handle
    // before creating a new worker, channels and OffscreenCanvas.
  }, [socket.log])

  useEffect(() => {
    if (running) return
    APP.getState().update(state => {
      transitionProjectionSession(state.system.carplay, { type: 'dongleDisconnected' })
      state.system.carplay.user = false
      state.system.carplay.source = null
      state.system.carplay.media = createEmptyCarplayMedia()
      state.system.interface.content = true
    })
    timer.current = setTimeout(() => {
      setRuntime(value => value + 1)
      setRunning(true)
      restarting.current = false
    }, USB_RELEASE_DELAY_MS)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [running])

  // Only a sustained healthy session replenishes the retry budget. One valid
  // packet before each failure must not turn bounded recovery into a loop.
  const healthy = useCallback(() => { attempts.current = 0 }, [])

  // Start a fresh browser against the already idle dongle. A physical reset is
  // reserved for recovery after a real startup/transport failure; resetting on
  // every launch can make this dongle disappear for more than ten seconds.
  return running ? <Carplay {...props} key={runtime} resetDevice={runtime > 0}
    onRecovery={recover} onHealthy={healthy} /> : null
}

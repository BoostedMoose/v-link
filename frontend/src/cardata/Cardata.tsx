import { useEffect, useMemo, useRef } from 'react'
import { CARWorker } from './worker/types'
import { DATA } from '@/store/Store';
import { APP } from '@/store/Store';

import Display from './helper/Display';
import Ignition from './helper/Ignition';
import Recorder from './helper/Recorder';

type ScreenSettings = { autoOpen: { value: boolean } };
type ShutdownSettings = { autoShutdown: { value: boolean }; shutdownDelay: { value: number }; messageTimeout: { value: number } };
type DashChartsSettings = { resolution: { value: number } };

function Cardata() {
  const settings       = APP((state) => state.settings)
  const modules        = APP((state) => state.modules)
  const autoOpen       = APP((state) => (state.settings.screen as ScreenSettings | undefined)?.autoOpen?.value ?? false)
  const ignState       = APP((state) => state.system.ignState)
  const autoShutdown   = APP((state) => (state.settings.shutdown as ShutdownSettings | undefined)?.autoShutdown?.value ?? false)
  const shutdownDelay  = APP((state) => (state.settings.shutdown as ShutdownSettings | undefined)?.shutdownDelay?.value ?? 0)
  const messageTimeout = APP((state) => (state.settings.shutdown as ShutdownSettings | undefined)?.messageTimeout?.value ?? 0)
  const isRecording    = APP((state) => state.system.isRecording)
  const resolution     = APP((state) => (state.settings.dash_charts as DashChartsSettings | undefined)?.resolution?.value ?? 100)



  const updateApp = APP((state) => state.update)

  const data = DATA((state) => state)
  const updateData = DATA((state) => state.update);

  const carWorker = useMemo(() => {
    const worker = new Worker(
      new URL('./worker/CarData.worker.ts', import.meta.url),
      { type: 'module' }
    ) as CARWorker
    return worker
  }, [])

  const latestRef = useRef<any>(null)

  useEffect(() => {
    // Worker responds with data *only when requested*
    carWorker.onmessage = (event) => {
      latestRef.current = event.data.values
    }

    let rafId: number
    let lastUpdate = 0

    const renderLoop = (time: number) => {
      if (time - lastUpdate > 1000/24) {
        // request new data from worker
        carWorker.postMessage({ type: 'request' })

        // if worker responded in time, consume it
        if (latestRef.current) {
          updateData(latestRef.current)
          latestRef.current = null
        }

        lastUpdate = time
      }

      rafId = requestAnimationFrame(renderLoop)
    }

    rafId = requestAnimationFrame(renderLoop)

    return () => {
      cancelAnimationFrame(rafId)
      carWorker.terminate()
    }
  }, [carWorker, updateData])

  return (
    <>
      <Display
        autoOpen={autoOpen}
      />
      <Ignition
        ignition={ignState}
        autoShutdown={autoShutdown}
        shutdownDelay={shutdownDelay}
        messageTimeout={messageTimeout}
        updateApp={updateApp}
      />
      <Recorder
        data={data.data as Record<string, string | number>}
        resolution={resolution}
        recording={isRecording}
        settings={settings}
        modules={modules}
      />
    </>
  );
}

export default Cardata

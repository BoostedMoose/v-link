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

interface WorkerResponse {
  type: string;
  data?: Record<string, any>;
  timestamp?: string;
  polling?: Record<string, number>;
}

function Cardata() {
  const settings = APP((state) => state.settings)
  const modules = APP((state) => state.modules)
  const autoOpen = APP((state) => (state.settings.screen as ScreenSettings | undefined)?.autoOpen?.value ?? false)
  const ignState = APP((state) => state.system.ignState)
  const autoShutdown = APP((state) => (state.settings.shutdown as ShutdownSettings | undefined)?.autoShutdown?.value ?? false)
  const shutdownDelay = APP((state) => (state.settings.shutdown as ShutdownSettings | undefined)?.shutdownDelay?.value ?? 0)
  const messageTimeout = APP((state) => (state.settings.shutdown as ShutdownSettings | undefined)?.messageTimeout?.value ?? 0)
  const isRecording = APP((state) => state.system.isRecording)
  const resolution = APP((state) => (state.settings.dash_charts as DashChartsSettings | undefined)?.resolution?.value ?? 100)

  const updateApp = APP((state) => state.update)

  const data = DATA((state) => state)
  const updateData = DATA((state) => state.updateData);
  const updatePolling = DATA((state) => state.updatePolling);
  const updateTimestamp = DATA((state) => state.updateTimestamp);

  const carWorker = useMemo(() => {
    const worker = new Worker(
      new URL('./worker/CarData.worker.ts', import.meta.url),
      { type: 'module' }
    ) as CARWorker
    return worker
  }, [])

  const latestData = useRef<any>(null)
  const latestPoll = useRef<any>(null)
  const latestTime = useRef<any>(null)

  useEffect(() => {
    carWorker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const { data, polling, timestamp } = event.data;

      if (data) {
        latestData.current = data;
      }

      if (polling) {
        latestPoll.current = polling;
      }

      if (timestamp) {
        latestTime.current = timestamp;
      }
    };

    let rafId: number
    let lastUpdate = 0

    const renderLoop = (time: number) => {
      if (time - lastUpdate > 1000 / 24) {
        // request new data from worker
        carWorker.postMessage({ type: 'request' })

        // if worker responded in time, consume it
        if (latestData.current) {
          updateData(latestData.current)
          latestData.current = null
        }

        if (latestPoll.current) {
          updatePolling(latestPoll.current)
          latestPoll.current = null
        }

        if (latestTime.current) {
          updateTimestamp(latestTime.current)
          latestTime.current = null
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
        timestamp={data.timestamp}
        resolution={resolution}
        recording={isRecording}
        settings={settings}
        modules={modules}
      />
    </>
  );
}

export default Cardata

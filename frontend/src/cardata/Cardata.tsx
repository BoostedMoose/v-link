import {
  useEffect,
  useMemo,
} from 'react'
import { CARWorker } from './worker/types'
import { DATA } from './../store/Store';
import { APP } from './../store/Store';

import Display from './helper/Display';
import Ignition from './helper/Ignition';
import Recorder from './helper/Recorder';

import { io } from "socket.io-client";
const sysChannel = io("ws://localhost:4001/sys")




function Cardata() {

  const app = APP((state) => state)
  const updateApp = APP((state) => state.update)

  const data = DATA((state) => state)
  const updateData = DATA((state) => state.update);

  const carWorker = useMemo(() => {
    const worker = new Worker(
      new URL('./worker/worker.ts', import.meta.url), {
      type: 'module'
    }
    ) as CARWorker
    return worker
  }, [])

  useEffect(() => {
    carWorker.onmessage = (event) => {
      const { type, message } = event.data;
      const newData = { [type]: message };
      updateData(newData.message)
    };

    return () => {
      // Clean up the worker when the component is unmounted
      carWorker.terminate();
    };
  }, []);

  return (
    <>
      <Display 
        autoOpen={app.settings.screen.autoOpen.value}
        io={sysChannel}
      />
      <Ignition
        ignition={app.system.ignition}
        autoShutdown={app.settings.shutdown.autoShutdown.value}
        shutdownDelay={app.settings.shutdown.shutdownDelay.value}
        messageTimeout={app.settings.shutdown.messageTimeout.value}
        updateApp={updateApp}
        io={sysChannel}
      />
      <Recorder 
        data={data.data}
        resolution={app.settings.dash_charts.resolution.value}
        setCount={app.settings.constants.chart_input_current}
        recording={app.system.recording}
        settings={app.settings}
        modules={app.modules}
        />
    </>
  );
}

export default Cardata

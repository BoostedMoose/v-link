/* eslint-disable no-case-declarations */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { findDevice, requestDevice, CommandMapping, } from 'node-carplay/web'
import { eventEmitter } from '@/app/helper/EventEmitter';
import { useNamespaces } from '@/socket/Namespaces';

import styled, { css, useTheme } from 'styled-components';


import { CarPlayWorker } from './worker/types'
import useCarplayAudio from './useCarplayAudio'
import { useCarplayTouch } from './useCarplayTouch'
import { InitEvent } from './worker/render/RenderEvents'

import { APP } from '@/store/Store';
import hexToRGBA from '@/app/helper/HexToRGBA'

import "./../themes.scss"

const Container = styled.div`
  position: relative;
  top: 0;
  left: 0;
  z-index: 2;

  height: 100%;
  width: 100%;
  touch-action: none;
  overflow: hidden;
`;

const Stream = styled.div`
  position: absolute;
  bottom: 0;
  zIndex: 1;

  height: 100%;
  width: 100%;

  padding: 0;
  margin: 0;
`

interface OverlayProps {
  isVisible: boolean;
  navVisible: boolean;
}

const Overlay = styled.div<OverlayProps>`
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  width: 100%;

  zIndex: 2;

  display: flex;
  justify-content: center;
  alignItems: center;
  background: ${({ theme }) => `linear-gradient(to bottom, ${hexToRGBA(theme.colors.bg1, 1)}, ${hexToRGBA(theme.colors.bg2, 1)})`};

  opacity: ${({ isVisible, navVisible }) => (isVisible ? 1 : navVisible ? 0.75 : 0)};
  pointer-events: none; /* Ensure the overlay does not block pointer events */
  transition: opacity 0.3s ease-in-out; /* Adjust duration and easing as needed */
`;


const videoChannel = new MessageChannel()
const micChannel = new MessageChannel()

const RETRY_DELAY_MS = 30000

interface CarplayProps {
  command: string,
  commandCounter: number
}

function Carplay({ command, commandCounter }: CarplayProps) {

  const socket = useNamespaces();

  const appUpdate       = APP((state) => state.update);
  const carplaySettings = APP((state) => state.system.carplay)
  const width           = APP((state) => state.system.carplaySize.width);
  const height          = APP((state) => state.system.carplaySize.height);
  const content         = APP((state) => state.system.interface.content)
  const navBar          = APP((state) => state.system.interface.navBar)

  const view            = APP((state) => state.system.view);
  type DongleConfig = Record<string, { value: unknown }>;
  type GeneralSettings = { exitToDash?: { value: boolean } };

  const dongleConfig = APP((state) => state.settings.dongle_config as DongleConfig | undefined);
  const exitToDash = APP((state) => (state.settings.general as GeneralSettings | undefined)?.exitToDash?.value ?? false);
  const exitToDashRef = useRef(exitToDash);

  useEffect(() => { exitToDashRef.current = exitToDash; }, [exitToDash]);
  const useStandardizedResolution = APP((state) => (state.settings.dongle_config as { useStandardizedResolution?: { value: boolean } } | undefined)?.useStandardizedResolution?.value ?? false);

  const [phoneState, setPhoneState] = useState<boolean | null>(false);
  const lastDongleConfigSigRef = useRef<string | null>(null);

  // Keys that must not be forwarded to the dongle driver
  const VLINK_ONLY_KEYS = ['useStandardizedResolution'];

  const flattenConfig = (config: Record<string, any>) => {
    const result: Record<string, any> = {};
    Object.entries(config).forEach(([key, value]) => {
      if (VLINK_ONLY_KEYS.includes(key)) return;
      if (typeof value === "object" && value !== null && "value" in value) {
        result[key] = value.value;
      }
    });
    return result;
  };

  const config = useMemo(() => {
    const dongleConfigFlat = dongleConfig ? flattenConfig(dongleConfig) : {};
    let configWidth  = width;
    let configHeight = height;

    if (useStandardizedResolution) {
      const standards = [
        { w: 800, h: 480 },
        { w: 960, h: 540 },
        { w: 1024, h: 600 },
        { w: 1280, h: 720 },
        { w: 1920, h: 1080 },
        { w: 2560, h: 1440 },
        { w: 3840, h: 2160 },
      ]
      const snap = standards.find(s => s.w >= width && s.h >= height)
      if (snap) {
        configWidth  = snap.w
        configHeight = snap.h
      }
    }
    const carplayConfig = {
      ...dongleConfigFlat,
      width: configWidth,
      height: configHeight,
    };
    
    const sig = JSON.stringify(dongleConfigFlat);
    if (sig !== lastDongleConfigSigRef.current) {
      socket.log.emit('info', `(CarPlay) Config: ${JSON.stringify(carplayConfig)}`);
      lastDongleConfigSigRef.current = sig;
    }

    return carplayConfig;
  }, [dongleConfig, width, height, useStandardizedResolution]);


  const mainElem = useRef<HTMLDivElement>(null)
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(
    null,
  )

  const renderWorker = useMemo(() => {
    if (!canvasElement) return

    const worker = new Worker(
      new URL('./worker/render/Render.worker.ts', import.meta.url), { type: 'module' },
    )
    const canvas = canvasElement.transferControlToOffscreen()
    worker.postMessage(new InitEvent(canvas, videoChannel.port2), [
      canvas,
      videoChannel.port2,
    ])
    return worker
  }, [canvasElement])

  useLayoutEffect(() => {
    if (canvasRef.current) {
      setCanvasElement(canvasRef.current)
    }
  }, [])

  const carplayWorker = useMemo(() => {
    const worker = new Worker(
      new URL('./worker/CarPlay.worker.ts', import.meta.url), { type: 'module' }
    ) as CarPlayWorker
    const payload = {
      videoPort: videoChannel.port1,
      microphonePort: micChannel.port1,
    }
    worker.postMessage({ type: 'initialise', payload }, [
      videoChannel.port1,
      micChannel.port1,
    ])
    return worker
  }, [])

  const { processAudio, getAudioPlayer, startRecording, stopRecording } =
    useCarplayAudio(carplayWorker, micChannel.port2)

  const clearRetryTimeout = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
      retryTimeoutRef.current = null
    }
  }, [])

  /* V-Link Mod */
  // Grabbing a message from renderWorker to get a notification when the stream is starting
  useEffect(() => {
    if (!renderWorker) return;
    renderWorker.onmessage = ev => {
      const { type } = ev.data;
      switch (type) {
        case 'streamStarted': {
          const { codec, codedWidth, codedHeight } = ev.data.config ?? {}
          socket.log.emit('info', `(CarPlay) Stream started: ${codedWidth}x${codedHeight} (${codec})`)
          // This useEffect will notify when the phone is connected and the stream started
          appUpdate((state) => {
            state.system.carplay.connected = true;
          });
          break;
        }
      }
    };
    renderWorker.onerror = (ev) => {
      socket.log.emit('error', `(CarPlay) Render worker error: ${ev.message} (${ev.filename}:${ev.lineno})`);
    };
    return () => {
      renderWorker.onmessage = null;
      renderWorker.onerror = null;
    };
  }, [renderWorker]);
  /* V-Link Mod */


  useEffect(() => {
    const handleEvent = () => {
      socket.log.emit('info', '(CarPlay) Pair Dongle')
      pairDongle();
    };

    eventEmitter.addEventListener("pairDongle", handleEvent);

    // Clean up the event listener on component unmount
    return () => {
      eventEmitter.removeEventListener("pairDongle", handleEvent);
    };
  }, []);

  // subscribe to worker messages
  useEffect(() => {
    carplayWorker.onmessage = ev => {
      const { type } = ev.data
      switch (type) {
        case 'plugged':
          console.log('(CarPlay) Worker connected')
          socket.log.emit('debug', '(CarPlay) Worker Connected')

          appUpdate((state) => {
            state.system.carplay.worker = true;
            state.system.carplay.phone = true;
          });

          break
        case 'unplugged':
          console.log('(CarPlay) Worker disconnected')
          socket.log.emit('debug', '(CarPlay) Worker Disconnected')

          appUpdate((state) => {
            state.system.carplay.worker = false;
            state.system.carplay.phone = false;
            state.system.carplay.user = false;

            state.system.interface.content = true
          });

          if (phoneState) {
            console.log('(CarPlay) Phone still connected... Streaming error?')
            socket.log.emit('debug', '(CarPlay) Phone still connected... Streaming error?')
          }

          break
        case 'requestBuffer':
          clearRetryTimeout()
          getAudioPlayer(ev.data.message)
          break
        case 'audio':
          clearRetryTimeout()
          processAudio(ev.data.message)
          break
        case 'media':
          //TODO: implement
          break
        case 'command':
          const {
            message: { value },
          } = ev.data
          switch (value) {
            case CommandMapping.startRecordAudio:
              startRecording()
              break
            case CommandMapping.stopRecordAudio:
              stopRecording()
              break
            case CommandMapping.requestHostUI:
              if (exitToDashRef.current) {
                appUpdate((state) => {
                  state.system.view = "Dashboard";
                });
              } else {
                appUpdate((state) => {
                  state.system.interface.navBar = true;
                });
              }
          }
          break
        case 'failure':
          if (retryTimeoutRef.current == null) {
            console.error(`Carplay initialization failed -- Reloading page in ${RETRY_DELAY_MS}ms`,)
            socket.log.emit('info', `Carplay initialization failed -- Trying to reload page.`,)
            retryTimeoutRef.current = setTimeout(() => {
              window.location.reload()
            }, RETRY_DELAY_MS)
          }
          break
      }
    }
  }, [carplayWorker, clearRetryTimeout, getAudioPlayer, processAudio, renderWorker, startRecording, stopRecording])

  useEffect(() => {
    const element = mainElem?.current
    if (!element) return;
    const observer = new ResizeObserver(() => {
      carplayWorker.postMessage({ type: 'frame' })
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, []);

  useEffect(() => {
    carplayWorker.postMessage({ type: 'keyCommand', command: command })
  }, [commandCounter]);

  // Request a new frame when re-entering the CarPlay view so key commands resume
  useEffect(() => {
    if (view !== 'Carplay') return
    carplayWorker.postMessage({ type: 'frame' })
  }, [view]);

  // Keep a ref to the latest config so checkDevice always sends fresh values
  const configRef = useRef(config)
  useEffect(() => { configRef.current = config }, [config])

  const checkDevice = useCallback(
    async (request: boolean = false) => {
      const device = request ? await requestDevice() : await findDevice()
      if (device) {
        carplayWorker.postMessage({ type: 'start', payload: { config: configRef.current } })

        console.log('Phone connected')
        socket.log.emit('info', '(CarPlay) Phone connected')
        setPhoneState(true)

        appUpdate((state) => {
          state.system.carplay.phone = true;
        });
      } else {
        const workerActive = APP.getState().system.carplay.worker
        if (!workerActive) {
          console.log('Phone disconnected')
          socket.log.emit('info', '(CarPlay) Phone disconnected')

          setPhoneState(false)
          appUpdate((state) => {
            state.system.carplay.phone = false;
          });
        }
      }
    },
    [carplayWorker]
  )

  // usb connect/disconnect handling and device check
  useEffect(() => {
    navigator.usb.onconnect = async () => {
      console.log('Dongle connected')
      socket.log.emit('info', '(CarPlay) Dongle connected')

      appUpdate((state) => {
        state.system.carplay.dongle = true;
        state.system.carplay.pair = true;
      });
      checkDevice()
    }

    navigator.usb.ondisconnect = async () => {
      const device = await findDevice()
      if (!device) {
        carplayWorker.postMessage({ type: 'stop' })
        console.log('Dongle disconnected')
        socket.log.emit('info', '(CarPlay) Dongle disconnected')

        setPhoneState(false)

        appUpdate((state) => {
          state.system.carplay.dongle = false;
          state.system.carplay.phone = false;
          state.system.carplay.stream = false;
          state.system.carplay.user = false;

        });
      }
    }

    //checkDevice()
  }, [carplayWorker, checkDevice])

  const pairDongle = useCallback(() => {
    checkDevice(true)
  }, [checkDevice])

  const sendTouchEvent = useCarplayTouch(carplayWorker)


  return (
    <Container>
      <Stream
        onPointerDown={sendTouchEvent}
        onPointerMove={sendTouchEvent}
        onPointerUp={sendTouchEvent}
        onPointerCancel={sendTouchEvent}

        style={{ height: height, width: width }}>

        <canvas
          ref={canvasRef}
          id="video"
          style={
            carplaySettings.paired && carplaySettings.dongle
              ? { display: 'block', width: '100%', height: '100%' }
              : { display: 'none' }
          }
        />
      </Stream>
      <Overlay isVisible={content} navVisible={navBar} />
    </Container>
  )
}

export default Carplay

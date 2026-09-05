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
import { transitionProjectionSession } from './sessionState'
import { createEmptyCarplayMedia, hasCarplayMediaIdentityChanged, mergeCarplayMedia, playbackStatusFromAudioCommand } from './mediaState'
import { CARPLAY_MEDIA_COMMAND_EVENT, type MediaCommand } from './mediaCommands'

import { APP } from '@/store/Store';
import hexToRGBA from '@/app/helper/HexToRGBA'
import { fitInside, isCompactViewport, projectionRequestSize } from '@/app/helper/Layout'
import type { ViewportSize } from '@/app/helper/Layout'

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

const STARTUP_WATCHDOG_MS = 12000
const USB_DETACH_DEBOUNCE_MS = 4000
const RETRY_BASE_MS = 1000
const RETRY_CAP_MS = 15000
const MAX_SESSION_RETRIES = 5

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
  const windowSize      = APP((state) => state.system.windowSize)
  const compact         = isCompactViewport(windowSize)

  const view            = APP((state) => state.system.view);
  type DongleConfig = Record<string, { value: unknown }>;
  type GeneralSettings = { exitToDash?: { value: boolean } };

  const dongleConfig = APP((state) => state.settings.dongle_config as DongleConfig | undefined);
  const exitToDash = APP((state) => (state.settings.general as GeneralSettings | undefined)?.exitToDash?.value ?? false);
  const exitToDashRef = useRef(exitToDash);
  const compactRef = useRef(compact);

  useEffect(() => { exitToDashRef.current = exitToDash; }, [exitToDash]);
  useEffect(() => { compactRef.current = compact; }, [compact]);
  const useStandardizedResolution = APP((state) => (state.settings.dongle_config as { useStandardizedResolution?: { value: boolean } } | undefined)?.useStandardizedResolution?.value ?? false);

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
    const projectionSize = projectionRequestSize(
      { width, height },
      useStandardizedResolution,
    );
    const carplayConfig = {
      ...dongleConfigFlat,
      androidWorkMode: dongleConfigFlat.androidWorkMode ?? true, // TODO check if this is needed, node-carplay should default to true
      width: projectionSize.width,
      height: projectionSize.height,
    };
    
    const sig = JSON.stringify(dongleConfigFlat);
    if (sig !== lastDongleConfigSigRef.current) {
      socket.log.emit('info', `(CarPlay) Config: ${JSON.stringify(carplayConfig)}`);
      lastDongleConfigSigRef.current = sig;
    }

    return carplayConfig;
  }, [dongleConfig, width, height, useStandardizedResolution]);

  const configRef = useRef(config)
  useEffect(() => { configRef.current = config }, [config])

  const [projectionSize, setProjectionSize] = useState<ViewportSize>({
    width: config.width,
    height: config.height,
  })
  const fittedProjection = useMemo(
    () => fitInside({ width, height }, projectionSize),
    [height, projectionSize, width],
  )

  useEffect(() => {
    if (carplaySettings.phase !== 'streaming') {
      setProjectionSize({ width: config.width, height: config.height })
    }
  }, [carplaySettings.phase, config.height, config.width])


  const mainElem = useRef<HTMLDivElement>(null)
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const startupWatchdogRef = useRef<NodeJS.Timeout | null>(null)
  const usbDetachTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const retryAttemptRef = useRef(0)

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

  const { processAudio, getAudioPlayer, resetAudioRouting, startRecording, stopRecording } =
    useCarplayAudio(carplayWorker, micChannel.port2)

  const clearRetryTimeout = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
      retryTimeoutRef.current = null
    }
  }, [])

  const clearStartupWatchdog = useCallback(() => {
    if (startupWatchdogRef.current) {
      clearTimeout(startupWatchdogRef.current)
      startupWatchdogRef.current = null
    }
  }, [])

  const scheduleSessionRecovery = useCallback((reason: string) => {
    if (retryTimeoutRef.current || !APP.getState().system.carplay.dongle) return

    clearStartupWatchdog()
    const attempt = ++retryAttemptRef.current
    if (attempt > MAX_SESSION_RETRIES) {
      socket.log.emit('error', `(CarPlay) Video recovery limit reached after: ${reason}`)
      return
    }

    const delay = Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_CAP_MS)
    socket.log.emit('info', `(CarPlay) Requesting a fresh video frame in ${delay}ms (${attempt}/${MAX_SESSION_RETRIES}): ${reason}`)

    retryTimeoutRef.current = setTimeout(() => {
      retryTimeoutRef.current = null
      if (!APP.getState().system.carplay.dongle) return

      // node-carplay has a permanently pending WebUSB transferIn(). Closing
      // and reopening here races that read and can crash its read loop with
      // AbortError/InvalidStateError. Keep the healthy phone/audio session and
      // ask the dongle for another video frame instead.
      carplayWorker.postMessage({ type: 'frame' })

      startupWatchdogRef.current = setTimeout(() => {
        startupWatchdogRef.current = null
        if (APP.getState().system.carplay.phase === 'connected') {
          scheduleSessionRecovery('phone remains connected without decoded video')
        }
      }, STARTUP_WATCHDOG_MS)
    }, delay)
  }, [carplayWorker, clearStartupWatchdog, socket.log])

  const armStartupWatchdog = useCallback(() => {
    clearStartupWatchdog()
    startupWatchdogRef.current = setTimeout(() => {
      startupWatchdogRef.current = null
      scheduleSessionRecovery('phone connected but no video stream arrived')
    }, STARTUP_WATCHDOG_MS)
  }, [clearStartupWatchdog, scheduleSessionRecovery])

  /* V-Link Mod */
  // Grabbing a message from renderWorker to get a notification when the stream is starting
  useEffect(() => {
    if (!renderWorker) return;
    renderWorker.onmessage = ev => {
      const { type } = ev.data;
      switch (type) {
        case 'streamStarted': {
          clearStartupWatchdog()
          clearRetryTimeout()
          retryAttemptRef.current = 0
          const { codec, codedWidth, codedHeight } = ev.data.config ?? {}
          const { displayWidth, displayHeight } = ev.data
          socket.log.emit(
            'info',
            `(CarPlay) Stream started: display=${displayWidth}x${displayHeight}, coded=${codedWidth}x${codedHeight} (${codec})`,
          )
          if (typeof displayWidth === 'number' && typeof displayHeight === 'number') {
            setProjectionSize({ width: displayWidth, height: displayHeight })
          } else if (typeof codedWidth === 'number' && typeof codedHeight === 'number') {
            setProjectionSize({ width: codedWidth, height: codedHeight })
          }
          appUpdate((state) => {
            transitionProjectionSession(state.system.carplay, { type: 'streamStarted' })
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
            transitionProjectionSession(state.system.carplay, { type: 'phoneConnected' })
          });
          armStartupWatchdog()
          break
        case 'unplugged':
          clearStartupWatchdog()
          resetAudioRouting()
          console.log('(CarPlay) Worker disconnected')
          socket.log.emit('debug', '(CarPlay) Worker Disconnected')

          appUpdate((state) => {
            transitionProjectionSession(state.system.carplay, { type: 'phoneDisconnected' })
            state.system.carplay.user = false;
            state.system.carplay.source = null
            state.system.carplay.media = createEmptyCarplayMedia()

            state.system.interface.content = true
          });

          break
        case 'requestBuffer':
          getAudioPlayer(ev.data.message)
          break
        case 'videoStats':
          console.log(`(CarPlay) Video message ${ev.data.count}: ${ev.data.bytes} bytes`)
          socket.log.emit('info', `(CarPlay) Video message ${ev.data.count}: ${ev.data.bytes} bytes`)
          break
        case 'diagnostic':
          console.info(ev.data.message)
          break
        case 'projectionSource': {
          const source = ev.data.source
          appUpdate((state) => {
            state.system.carplay.source = source
          })
          break
        }
        case 'audio': {
          const audio = ev.data.message
          appUpdate((state) => {
            state.system.carplay.media.playbackStatus = playbackStatusFromAudioCommand(
              state.system.carplay.media.playbackStatus,
              audio.command,
            )
          })
          processAudio(audio)
          break
        }
        case 'media': {
          const payload = ev.data.message.payload

          if (!payload) break

          appUpdate((state) => {
            const previousMedia = state.system.carplay.media
            const nextMedia = mergeCarplayMedia(previousMedia, payload)
            if (hasCarplayMediaIdentityChanged(previousMedia, nextMedia)) {
              console.info(
                `(CarPlay) Media changed: title=${JSON.stringify(nextMedia.title)} artist=${JSON.stringify(nextMedia.artist)}`,
              )
            }
            state.system.carplay.media = nextMedia
          })

          break
        }
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
              if (exitToDashRef.current || compactRef.current) {
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
          clearStartupWatchdog()
          const failureMessage =
            'message' in ev.data && typeof ev.data.message === 'string'
              ? ev.data.message
              : 'CarPlay worker initialization failed'
          appUpdate((state) => {
            transitionProjectionSession(state.system.carplay, {
              type: 'failed',
              error: failureMessage,
            })
          });
          // A page reload terminates the worker and lets Chromium release the
          // outstanding WebUSB read. Calling USBDevice.close() from inside the
          // live worker is unsafe while node-carplay's transferIn is pending.
          if (retryTimeoutRef.current == null) {
            socket.log.emit('error', `(CarPlay) USB driver failed; reloading projection runtime`)
            retryTimeoutRef.current = setTimeout(() => window.location.reload(), 3000)
          }
          break
      }
    }
  }, [armStartupWatchdog, carplayWorker, clearRetryTimeout, clearStartupWatchdog, getAudioPlayer, processAudio, renderWorker, resetAudioRouting, startRecording, stopRecording])

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

  useEffect(() => {
    const handleMediaCommand = (event: Event) => {
      const command = (event as CustomEvent<MediaCommand>).detail
      if (command === 'playOrPause') {
        appUpdate((state) => {
          const media = state.system.carplay.media
          media.playbackStatus = media.playbackStatus > 0 ? 0 : 1
        })
      }
      carplayWorker.postMessage({ type: 'keyCommand', command })
      socket.log.emit('debug', `(CarPlay) Media command: ${command}`)
    }

    eventEmitter.addEventListener(CARPLAY_MEDIA_COMMAND_EVENT, handleMediaCommand)
    return () => eventEmitter.removeEventListener(CARPLAY_MEDIA_COMMAND_EVENT, handleMediaCommand)
  }, [carplayWorker, socket.log]);

  // Request a new frame when re-entering the CarPlay view so key commands resume
  useEffect(() => {
    if (view !== 'Carplay') return
    carplayWorker.postMessage({ type: 'frame' })
  }, [view]);

  const checkDevice = useCallback(
    async (request: boolean = false) => {
      const device = request ? await requestDevice() : await findDevice()
      appUpdate((state) => {
        state.system.carplay.detectionComplete = true
      })
      if (device) {
        const phase = APP.getState().system.carplay.phase
        appUpdate((state) => {
          transitionProjectionSession(state.system.carplay, { type: 'dongleDetected' })
          state.system.carplay.paired = true
        })

        if (phase === 'idle' || phase === 'ready' || phase === 'error') {
          appUpdate((state) => {
            transitionProjectionSession(state.system.carplay, { type: 'startRequested' })
          })
          carplayWorker.postMessage({ type: 'start', payload: { config: configRef.current } })
        }

        console.log('Dongle detected')
        socket.log.emit('info', '(CarPlay) Dongle detected')
      } else {
        const workerActive = APP.getState().system.carplay.worker
        if (!workerActive) {
          console.log('Dongle not detected')
          socket.log.emit('info', '(CarPlay) Dongle not detected')
          appUpdate((state) => {
            transitionProjectionSession(state.system.carplay, { type: 'dongleDisconnected' })
          });
        }
      }
    },
    [carplayWorker]
  )

  // usb connect/disconnect handling and device check
  useEffect(() => {
    navigator.usb.onconnect = async () => {
      if (usbDetachTimeoutRef.current) {
        clearTimeout(usbDetachTimeoutRef.current)
        usbDetachTimeoutRef.current = null
      }
      console.log('Dongle connected')
      socket.log.emit('info', '(CarPlay) Dongle connected')

      appUpdate((state) => {
        transitionProjectionSession(state.system.carplay, { type: 'dongleDetected' })
        state.system.carplay.paired = true
        state.system.carplay.pair = true;
      });
      checkDevice()
    }

    navigator.usb.ondisconnect = async () => {
      if (usbDetachTimeoutRef.current) clearTimeout(usbDetachTimeoutRef.current)
      usbDetachTimeoutRef.current = setTimeout(async () => {
        usbDetachTimeoutRef.current = null
        const device = await findDevice()
        if (device) return

        clearRetryTimeout()
        clearStartupWatchdog()
        retryAttemptRef.current = 0
        carplayWorker.postMessage({ type: 'stop' })
        console.log('Dongle disconnected')
        socket.log.emit('info', '(CarPlay) Dongle disconnected')

        appUpdate((state) => {
          transitionProjectionSession(state.system.carplay, { type: 'dongleDisconnected' })
          state.system.carplay.user = false;
          state.system.carplay.source = null
        });
      }, USB_DETACH_DEBOUNCE_MS)
    }

    // WebUSB does not emit a connect event for a dongle that was already
    // present when the page opened.
    void checkDevice()

    return () => {
      navigator.usb.onconnect = null
      navigator.usb.ondisconnect = null
      if (usbDetachTimeoutRef.current) clearTimeout(usbDetachTimeoutRef.current)
      clearRetryTimeout()
      clearStartupWatchdog()
    }
  }, [appUpdate, carplayWorker, checkDevice, clearRetryTimeout, clearStartupWatchdog, socket.log])

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

        style={{
          height: fittedProjection.height,
          width: fittedProjection.width,
          left: fittedProjection.left,
          top: fittedProjection.top,
        }}>

        <canvas
          ref={canvasRef}
          id="video"
          style={
            carplaySettings.paired && carplaySettings.dongle
              ? { display: 'block', width: '100%', height: '100%', objectFit: 'contain' }
              : { display: 'none' }
          }
        />
      </Stream>
      <Overlay isVisible={content} navVisible={navBar} />
    </Container>
  )
}

export default Carplay

/* eslint-disable no-case-declarations */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { findDevice, requestDevice, CommandMapping, } from 'node-carplay/web'

import styled, { css, useTheme } from 'styled-components';


import { CarPlayWorker } from './worker/types'
import useCarplayAudio from './useCarplayAudio'
import { useCarplayTouch } from './useCarplayTouch'
import { InitEvent } from './worker/render/RenderEvents'

import { RotatingLines } from 'react-loader-spinner'
import { APP, MMI } from '../store/Store';
import  hexToRGBA  from '../app/helper/HexToRGBA'

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

const Overlay = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  width: 100%;
  
  display: flex;
  justify-content: center;
  alignItems: center;
  background: ${({ theme }) =>`linear-gradient(to bottom, ${hexToRGBA(theme.colors.bg1, 1)}, ${hexToRGBA(theme.colors.bg2, 1)})`};

  opacity: ${({ isVisible }) => (isVisible ? 0 : 1)};
  pointer-events: none; /* Ensure the overlay does not block pointer events */
  transition: opacity 1s ease-in-out; /* Adjust duration and easing as needed */
`;


const videoChannel = new MessageChannel()
const micChannel = new MessageChannel()

const RETRY_DELAY_MS = 30000

interface CarplayProps {
  command: string,
  commandCounter: number
}

function Carplay({ command, commandCounter }: CarplayProps) {

  const app = APP((state) => state);
  const mmi = MMI((state) => state);

  const theme = useTheme();

  const [dongleState, setDongleState] = useState<Boolean | null>(false);
  const [phoneState, setPhoneState] = useState<Boolean | null>(false);
  const [streamState, setStreamState] = useState<Boolean | null>(false);

  const width = app.system.carplaySize.width
  const height = app.system.carplaySize.height

  const config = {
    fps: mmi.config.fps,
    width: width,
    height: height,
    mediaDelay: mmi.config.delay
  }

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
        case 'streamStarted':
          //console.log('phone1:', app.system.carplay.phone)
          app.update({ system: { carplay: { ...app.system.carplay, stream: true } } })
          setStreamState(true)
          //console.log('phone2:', app.system.carplay.phone)

          break;
      }
    };
    return () => {
      renderWorker.onmessage = null; // Clean up the listener when the worker changes
    };
  }, [renderWorker]);

  useEffect(() => {
    console.log('dongle:', dongleState)
    console.log('phone:', phoneState)
    console.log('stream:', streamState)
    console.log('user:', app.system.carplay.user)
  }, [dongleState, phoneState, streamState, app.system.carplay.user])
  /* V-Link Mod */

  // subscribe to worker messages
  useEffect(() => {
    carplayWorker.onmessage = ev => {
      const { type } = ev.data
      switch (type) {
        case 'plugged':
          console.log('Worker connected')
          //setDongleState(true)
          //app.update({ system: { carplay: { ...app.system.carplay, dongle: true } } })
          break
        case 'unplugged':
          console.log('Worker disconnected')
          //setDongleState(false)
          //setStreamState(false)
          app.update({ system: { carplay: { ...app.system.carplay, dongle: false } } })
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
              app.update({ system: { ...app.system, view: "Dashboard" } })
          }
          break
        case 'failure':
          if (retryTimeoutRef.current == null) {
            console.error(
              `Carplay initialization failed -- Reloading page in ${RETRY_DELAY_MS}ms`,
            )
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
      //console.log("size change")
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

  const checkDevice = useCallback(
    async (request: boolean = false) => {
      const device = request ? await requestDevice() : await findDevice()
      if (device) {
        console.log('Dongle connected')
        setPhoneState(true)
        app.update({ system: { carplay: { ...app.system.carplay, phone: true } } })
        carplayWorker.postMessage({ type: 'start', payload: { config } })
      } else {
        console.log('Dongle disconnected')
        setPhoneState(false)
        setStreamState(false)
        app.update({ system: { carplay: { ...app.system.carplay, phone: false, stream: false, user: false } } })

      }
    },
    [carplayWorker]
  )

  // usb connect/disconnect handling and device check
  useEffect(() => {
    navigator.usb.onconnect = async () => {
      console.log('Dongle disconnected')
      setDongleState(false)
      app.update({ system: { carplay: { ...app.system.carplay, dongle: false, phone: false, stream: false, user: false } } })
      checkDevice()
    }

    navigator.usb.ondisconnect = async () => {
      const device = await findDevice()
      if (!device) {
        carplayWorker.postMessage({ type: 'stop' })
        console.log('Dongle disconnected')
        setDongleState(false)
        setPhoneState(false)
        setStreamState(false)
        app.update({ system: { carplay: { ...app.system.carplay, dongle: false, phone: false, stream: false, user: false } } })
      }
    }

    //checkDevice()
  }, [carplayWorker, checkDevice])

  const onClick = useCallback(() => {
    checkDevice(true)
  }, [checkDevice])

  const sendTouchEvent = useCarplayTouch(carplayWorker, width, height)


  return (
    <Container>


      <Stream
        onPointerDown={sendTouchEvent}
        onPointerMove={sendTouchEvent}
        onPointerUp={sendTouchEvent}
        onPointerCancel={sendTouchEvent}
        onPointerOut={sendTouchEvent}>

        <canvas
          ref={canvasRef}
          id="video"
          style={

            phoneState && streamState
              ? { height: '100%', overflow: 'hidden' }
              : { display: 'none' }
          }
        />
      </Stream>

      <Overlay isVisible={phoneState && streamState && app.system.carplay.user && !app.system.interface.content}>
        {/* 

        {deviceFound === false && (

          <div style={{
            color: "var(--textColorDefault)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}>
            <div className="column">
              <h3>Connect phone or click to pair dongle.</h3>
              <p />
              <button className="button-styles nav-button" onClick={onClick} style={{ fill: 'var(--boxColorLighter)' }}>
              </button>
            </div>

          </div>
        )}
        {deviceFound === true && (
          <div style={{ width: '100%', height: '100%', backgroundColor: theme.colors.gradients.gradient1 }}>
            <RotatingLines
              strokeColor="grey"
              strokeWidth="5"
              animationDuration="0.75"
              width="96"
              visible={true}
            />
          </div>
        )}
          */}
      </Overlay>
    </Container>
  )
}

export default Carplay
import { useCallback, useEffect, useRef } from 'react'
import { WebMicrophone } from 'node-carplay/web'

import { useNamespaces } from '@/socket/Namespaces'

interface MicrophoneResources {
  context: AudioContext
  microphone: WebMicrophone
  stream: MediaStream
}

export const decibelsToGain = (decibels: number) => 10 ** (decibels / 20)

const releaseMicrophone = (resources: MicrophoneResources | null) => {
  if (!resources) return
  resources.microphone.destroy()
  resources.stream.getTracks().forEach((track) => track.stop())
  if (resources.context.state !== 'closed') {
    void resources.context.close().catch((error) => {
      console.warn('Failed to close CarPlay microphone context', error)
    })
  }
}

export const useCarplayMicrophone = (
  microphonePort: MessagePort,
  gainDb: number,
) => {
  const gainDbRef = useRef(gainDb)
  const gainRef = useRef<GainNode | null>(null)
  const resourcesRef = useRef<MicrophoneResources | null>(null)
  const socket = useNamespaces()

  useEffect(() => {
    gainDbRef.current = gainDb
    const context = resourcesRef.current?.context
    gainRef.current?.gain.setTargetAtTime(
      decibelsToGain(gainDb),
      context?.currentTime ?? 0,
      0.05,
    )
  }, [gainDb])

  useEffect(() => {
    let cancelled = false

    const initMicrophone = async () => {
      let stream: MediaStream | null = null
      let context: AudioContext | null = null
      let microphone: WebMicrophone | null = null

      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        context = new AudioContext()
        const source = context.createMediaStreamSource(stream)
        const gain = context.createGain()
        const output = context.createMediaStreamDestination()
        gain.gain.value = decibelsToGain(gainDbRef.current)
        source.connect(gain).connect(output)
        microphone = new WebMicrophone(output.stream, microphonePort)

        if (cancelled) {
          releaseMicrophone({ context, microphone, stream })
          return
        }

        gainRef.current = gain
        resourcesRef.current = { context, microphone, stream }
      } catch (error) {
        stream?.getTracks().forEach((track) => track.stop())
        if (context?.state !== 'closed') void context?.close()
        if (cancelled) return
        console.warn('Failed to init microphone', error)
        socket.log.emit('error', `(CarPlay) Failed to init microphone: ${error}`)
      }
    }

    void initMicrophone()

    return () => {
      cancelled = true
      releaseMicrophone(resourcesRef.current)
      resourcesRef.current = null
      gainRef.current = null
    }
  }, [microphonePort, socket])

  const startRecording = useCallback(() => {
    void resourcesRef.current?.microphone.start()
  }, [])

  const stopRecording = useCallback(() => {
    resourcesRef.current?.microphone.stop()
  }, [])

  return { startRecording, stopRecording }
}

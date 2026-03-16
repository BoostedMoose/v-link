import { useCallback, useEffect, useState } from 'react'
import {
  AudioCommand,
  AudioData,
  WebMicrophone,
  decodeTypeMap,
} from 'node-carplay/web'
import { PcmPlayer } from 'pcm-ringbuf-player'
import { AudioPlayerKey, CarPlayWorker } from './worker/types'
import { createAudioPlayerKey } from './worker/utils'
import { useNamespaces } from '@/socket/Namespaces'

//TODO: allow to configure
const defaultAudioVolume = 1
const defaultNavVolume = 1

const useCarplayAudio = (
  worker: CarPlayWorker,
  microphonePort: MessagePort,
) => {
  const [mic, setMic] = useState<WebMicrophone | null>(null)
  const [audioPlayers] = useState(new Map<AudioPlayerKey, PcmPlayer>())

  const socket = useNamespaces();

  const getAudioPlayer = useCallback(
    (audio: AudioData): PcmPlayer => {
      const { decodeType, audioType } = audio
      const format = decodeTypeMap[decodeType]
      const audioKey = createAudioPlayerKey(decodeType, audioType)
      let player = audioPlayers.get(audioKey)
      if (player) return player
      player = new PcmPlayer(format.frequency, format.channel)

      console.log(`(CarPlay) Player: ${player}`)
      socket.log.emit('debug', `(CarPlay) Player: ${player}`)


      audioPlayers.set(audioKey, player)
      player.volume(defaultAudioVolume)
      player.start()
      worker.postMessage({
        type: 'audioBuffer',
        payload: {
          sab: player.getRawBuffer(),
          decodeType,
          audioType,
        },
      })
      return player
    },
    [audioPlayers, worker],
  )

  const processAudio = useCallback(
    (audio: AudioData) => {
      if (audio.volumeDuration) {
        const { volume, volumeDuration } = audio
        const player = getAudioPlayer(audio)
        player.volume(volume, volumeDuration)
      } else if (audio.command) {
        switch (audio.command) {
          case AudioCommand.AudioNaviStart:
            const navPlayer = getAudioPlayer(audio)
            navPlayer.volume(defaultNavVolume)
            break
          case AudioCommand.AudioMediaStart:
          case AudioCommand.AudioOutputStart:

            console.log(`(CarPlay) Audio: ${audio}`)
            socket.log.emit('debug', `(CarPlay) Audio: ${audio}`)

            const mediaPlayer = getAudioPlayer(audio)
            mediaPlayer.volume(defaultAudioVolume)
            break
        }
      }
    },
    [getAudioPlayer],
  )

  // audio init
  useEffect(() => {
    const initMic = async () => {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        })
        const mic = new WebMicrophone(mediaStream, microphonePort)
        setMic(mic)
      } catch (err) {
        console.warn('Failed to init microphone', err)
        socket.log.emit('error', `(CarPlay) Failed to init microphone: ${err}`)
      }
    }

    initMic()

    return () => {
      audioPlayers.forEach(p => p.stop())
    }
  }, [audioPlayers, worker, microphonePort])

  const startRecording = useCallback(() => {
    mic?.start()
  }, [mic])

  const stopRecording = useCallback(() => {
    mic?.stop()
  }, [mic])

  return { processAudio, getAudioPlayer, startRecording, stopRecording }
}

export default useCarplayAudio

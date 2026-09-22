import type { DongleConfig } from 'node-carplay/node'

export type MostStream = {
  fBlockID: number
  instanceID: number
  sinkNr: number
  sourceAddrHigh: number
  sourceAddrLow: number
}

export type Most = {
  stream?: MostStream
}

export type ExtraConfig = DongleConfig & {
  kiosk: boolean,
  camera: string,
  microphone: string,
  piMost: boolean,
  canbus: boolean,
  bindings: KeyBindings,
  most?: Most,
  canConfig?: CanConfig
}

export interface KeyBindings {
  'selectDown': string,
  'selectUp': string,
  'back': string,
  'up': string,
  'down': string,
  'left': string,
  'right': string,
  'home': string,
  'play': string,
  'pause': string,
  'next': string,
  'prev': string
  'acceptPhone': string,
  'rejectPhone': string
}

export interface CanMessage {
  canId: number,
  byte: number,
  mask: number
}

export interface CanConfig {
  reverse?: CanMessage,
  lights?: CanMessage
}

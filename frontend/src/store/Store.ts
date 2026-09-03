import { create } from 'zustand';
import {immer} from 'zustand/middleware/immer'
import type { ReactNode } from 'react'
import type { ProjectionPhase, ProjectionTransport } from '@/carplay/sessionState'
import { createEmptyCarplayMedia, type CarplayMediaState, type ProjectionSource } from '@/carplay/mediaState'

interface SizeState {
  width: number;
  height: number;
}

interface CarplayState {
  detectionComplete: boolean;
  phase: ProjectionPhase;
  transport: ProjectionTransport;
  error: string | null;
  dongle: boolean;
  phone: boolean;
  stream: boolean;
  user: boolean;
  worker: boolean;
  fullscreen: boolean;
  paired: boolean;
  connected: boolean;
  pair?: boolean;
  source: ProjectionSource;
  media: CarplayMediaState;
}

interface InterfaceState {
  topBar: boolean;
  navBar: boolean;
  sideBar: boolean;
  content: boolean;
  carplay: boolean;
}

interface ModalState {
  visible: boolean;
  title: string | null;
  content: ReactNode;
  exit?: boolean | null;
}

interface SystemState {
  version: string;
  view: string;
  switch: string;
  lastUpdate: number;
  firstStart: boolean;
  settingPage: string;
  configLoaded: boolean;
  initialized: boolean;
  startedUp: boolean;
  isRecording: boolean;
  windowSize: SizeState;
  contentSize: SizeState;
  carplaySize: SizeState;
  carplay: CarplayState;
  audioSource: 'carplay' | 'local';
  interface: InterfaceState;
  modal: ModalState;
  wifiState: boolean;
  btState: boolean;
  canState: boolean;
  adcState: boolean;
  swcState: boolean;
  rtiState: boolean;
  ignState: boolean;
  // Set at runtime via Socket.tsx
  reverse?: boolean;
  rearcam?: boolean;
  rearcamError?: string | null;
}

export interface AppState {
  modules: Record<string, unknown>;
  settings: Record<string, unknown>;
  system: SystemState;
  update: (updater: (state: AppState) => void) => void;
  keyStroke: string;
  setKeyStroke: (key: string) => void;
  switchPage: string;
  setSwitchPage: (key: string) => void;
  pauseKeyBinds: boolean;
  setPauseKeyBinds: (paused: boolean) => void;
}

export interface ModuleState {
  system: { state: boolean };
  settings: Record<string, unknown>;
  update: (updater: (state: ModuleState) => void) => void;
}

export interface DataState {
  data: Record<string, unknown>;
  polling: Record<string, number>;
  timestamp: string;
  updateData: (newData: Record<string, unknown>) => void;
  updatePolling: (newPolling: Record<string, number>) => void;
  updateTimestamp: (newTimestamp: string) => void;
}


const APP = create<AppState>()(
  immer((set) => ({
    modules: {},
    settings: {},
    system: {
      version: 'v3.1.0',
      view: '',
      switch: 'ArrowUp',
      lastUpdate: 0,

      firstStart: true,
      settingPage: 'general',

      configLoaded: false,
      initialized: false,
      startedUp: false,
      isRecording: false,

      windowSize: {
        width: 800,
        height: 480,
      },

      contentSize: {
        width: 800,
        height: 480,
      },

      carplaySize: {
        width: 800,
        height: 460,
      },

      carplay: {
        detectionComplete: false,
        phase: 'idle',
        transport: null,
        error: null,
        dongle: false,
        phone: false,
        stream: false,
        user: false,
        worker: false,
        fullscreen: false,
        paired: false,
        connected: false,
        source: null,
        media: createEmptyCarplayMedia(),
      },
      audioSource: 'carplay',

      interface: {
        topBar: true,
        navBar: true,
        sideBar: true,
        content: true,
        carplay: false,
      },

      modal: {
        visible: false,
        title: null,
        content: null,
      },

      wifiState: false,
      btState: false,

      canState: false,
      adcState: false,
      swcState: false,
      rtiState: false,
      ignState: true,
    },

    update: (updater) => set(updater),

    // Handle keystrokes for MMI remote control
    keyStroke: '',
    setKeyStroke: (key) => {
      set((state) => {
        state.keyStroke = key
      })
      setTimeout(
        () =>
          set((state) => {
            state.keyStroke = ''
          }),
        0
      )
    },

    // Keybind for switching pages
    switchPage: 'ArrowUp',
    setSwitchPage: (key) => {
      set((state) => {
        state.switchPage = key
      })
    },

    // Pause keybind processing
    pauseKeyBinds: false,
    setPauseKeyBinds: (paused) => {
      set((state) => {
        state.pauseKeyBinds = paused
      })
    },
  }))
);

const CAN = create<ModuleState>()(
  immer((set) => ({
    system: {
      state: false,
    },
    settings: {},
    update: (updater) => set(updater),
  }))
);

const SWC = create<ModuleState>()(
  immer((set) => ({
    system: {
      state: false,
    },
    settings: {},
    update: (updater) => set(updater),
  }))
);

const ADC = create<ModuleState>()(
  immer((set) => ({
    system: {
      state: false,
    },
    settings: {},
    update: (updater) => set(updater),
  }))
);

const RTI = create<ModuleState>()(
  immer((set) => ({
    system: {
      state: false,
    },
    settings: {},
    update: (updater) => set(updater),
  }))
);

const DATA = create<DataState>()(
  immer((set) => ({
    data: {},
    polling: {},
    timestamp: '',
    updateData: (newData) =>
      set((state) => {
        Object.assign(state.data, newData);
      }),
    updatePolling: (newPolling) =>
      set((state) => {
        Object.assign(state.polling, newPolling);
      }),
    updateTimestamp: (newTimestamp) =>
      set((state) => {
        state.timestamp = newTimestamp;
      }),
  }))
);

const modules = {
  app: APP,
  can: CAN,
  swc: SWC,
  adc: ADC,
  rti: RTI,
}

// theme color helper
export type ThemeColorKey = 'green' | 'blue' | 'red' | 'white';

type GeneralSettings = { colorTheme?: { value: string } };

export const useThemeColor = (): ThemeColorKey =>
    (APP((state) =>
        (state.settings.general as GeneralSettings | undefined)?.colorTheme?.value ?? 'blue'
    ) as string).toLowerCase() as ThemeColorKey;

export { APP, CAN, SWC, ADC, RTI, DATA, modules };

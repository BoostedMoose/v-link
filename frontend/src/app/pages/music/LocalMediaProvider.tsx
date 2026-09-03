import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { APP } from '@/store/Store';
import { eventEmitter } from '@/app/helper/EventEmitter';
import { LOCAL_MEDIA_COMMAND_EVENT, type LocalMediaCommand } from './localMediaCommands';
import { duckingOutputLevel, getAudioSettings, NAVIGATION_DUCKING_EVENT } from '../settings/audioSettingsState';
import { sendCarplayMediaCommand } from '@/carplay/mediaCommands';
import {
  isProjectionAudioInterrupted,
  PROJECTION_AUDIO_INTERRUPTION_EVENT,
} from '@/carplay/audioFocus';

const AUDIO_EXTENSIONS = ['.aac', '.flac', '.m4a', '.mp3', '.ogg', '.opus', '.wav', '.webm'];

export interface LocalTrack {
  name: string;
  url: string;
  file?: File;
  sourcePath?: string;
}

export interface BackendMediaEntry {
  kind: 'directory' | 'file';
  name: string;
  path: string;
}

export type RepeatMode = 'off' | 'all' | 'one';

interface DirectoryHandleWithValues {
  readonly name: string;
  values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>;
  queryPermission(options?: { mode: 'read' }): Promise<PermissionState>;
  requestPermission(options?: { mode: 'read' }): Promise<PermissionState>;
}

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: () => Promise<DirectoryHandleWithValues>;
}

interface LocalMediaContextValue {
  folderName: string;
  tracks: LocalTrack[];
  currentTrack: number | null;
  error: string | null;
  playing: boolean;
  position: number;
  duration: number;
  shuffle: boolean;
  repeatMode: RepeatMode;
  chooseFolder: () => Promise<boolean>;
  loadBackendTracks: (folder: string, entries: BackendMediaEntry[], index: number) => Promise<void>;
  playTrack: (index: number) => Promise<void>;
  playNext: (fromEnded?: boolean) => void;
  playPrevious: () => void;
  togglePlayback: () => Promise<void>;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
}

const LocalMediaContext = createContext<LocalMediaContextValue | null>(null);

const DATABASE_NAME = 'v-link-local-media';
const DIRECTORY_STORE = 'directories';
const DIRECTORY_KEY = 'selected';
const SHUFFLE_KEY = 'v-link-local-media-shuffle';
const REPEAT_KEY = 'v-link-local-media-repeat';
const MEDIA_API = 'http://localhost:4001/api/media';
const CURRENT_TRACK_KEY = 'v-link-local-media-current-track';

interface StoredTrack {
  kind: 'native' | 'backend';
  name: string;
  path?: string;
}

const readStoredTrack = (): StoredTrack | null => {
  try {
    return JSON.parse(localStorage.getItem(CURRENT_TRACK_KEY) || 'null') as StoredTrack | null;
  } catch {
    return null;
  }
};

const storeTrack = (track: LocalTrack) => {
  try {
    localStorage.setItem(CURRENT_TRACK_KEY, JSON.stringify({
      kind: track.sourcePath ? 'backend' : 'native',
      name: track.name,
      path: track.sourcePath,
    } satisfies StoredTrack));
  } catch {
    // Persistence is optional.
  }
};

const readStoredShuffle = () => {
  try {
    return localStorage.getItem(SHUFFLE_KEY) === 'true';
  } catch {
    return false;
  }
};

const readStoredRepeatMode = (): RepeatMode => {
  try {
    const mode = localStorage.getItem(REPEAT_KEY);
    return mode === 'all' || mode === 'one' ? mode : 'off';
  } catch {
    return 'off';
  }
};

const openDirectoryDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DATABASE_NAME, 1);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(DIRECTORY_STORE)) {
      request.result.createObjectStore(DIRECTORY_STORE);
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const readSavedDirectory = async () => {
  const database = await openDirectoryDatabase();
  return new Promise<DirectoryHandleWithValues | null>((resolve, reject) => {
    const transaction = database.transaction(DIRECTORY_STORE);
    const request = transaction.objectStore(DIRECTORY_STORE).get(DIRECTORY_KEY);
    request.onsuccess = () => resolve((request.result as DirectoryHandleWithValues | undefined) ?? null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  });
};

const saveDirectory = async (directory: DirectoryHandleWithValues) => {
  const database = await openDirectoryDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(DIRECTORY_STORE, 'readwrite');
    transaction.objectStore(DIRECTORY_STORE).put(directory, DIRECTORY_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
};

const isAudioFile = (file: File) => {
  const name = file.name.toLowerCase();
  return file.type.startsWith('audio/') || AUDIO_EXTENSIONS.some((extension) => name.endsWith(extension));
};

export const shouldAutoplayRestoredTrack = (
  detectionComplete: boolean,
  phoneConnected: boolean,
  autoplayEnabled: boolean,
) => detectionComplete && !phoneConnected && autoplayEnabled;

export const LocalMediaProvider = ({ children }: { children: ReactNode }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const urlsRef = useRef<string[]>([]);
  const savedDirectoryRef = useRef<DirectoryHandleWithValues | null>(null);
  const shuffleHistoryRef = useRef<number[]>([]);
  const restoredAudioRef = useRef<HTMLAudioElement | null>(null);
  const resumeAfterProjectionRef = useRef(false);
  const projectionDetectionComplete = APP((state) => state.system.carplay.detectionComplete);
  const phoneConnected = APP((state) => state.system.carplay.phone);
  const audioSource = APP((state) => state.system.audioSource);
  const [folderName, setFolderName] = useState('Local Media');
  const [tracks, setTracks] = useState<LocalTrack[]>([]);
  const [currentTrack, setCurrentTrack] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [shuffle, setShuffle] = useState(readStoredShuffle);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(readStoredRepeatMode);

  const restoreTrack = (nextTracks: LocalTrack[], index: number) => {
    const audio = audioRef.current;
    const track = nextTracks[index];
    if (!audio || !track) return;
    setCurrentTrack(index);
    shuffleHistoryRef.current = [index];
    audio.src = track.url;
    restoredAudioRef.current = audio;
  };

  useEffect(() => {
    const audio = restoredAudioRef.current;
    if (!audio || !projectionDetectionComplete) return;
    restoredAudioRef.current = null;
    const autoplayEnabled = getAudioSettings().autoplayLocalMedia;
    if (!shouldAutoplayRestoredTrack(projectionDetectionComplete, phoneConnected, autoplayEnabled)) return;
    APP.getState().update((state) => { state.system.audioSource = 'local'; });
    void audio.play().catch(() => {
      APP.getState().update((state) => { state.system.audioSource = 'carplay'; });
    });
  }, [currentTrack, phoneConnected, projectionDetectionComplete]);

  const releaseUrls = () => {
    urlsRef.current.forEach(URL.revokeObjectURL);
    urlsRef.current = [];
  };

  useEffect(() => releaseUrls, []);

  useEffect(() => {
    if (audioSource === 'carplay') {
      resumeAfterProjectionRef.current = false;
      if (!audioRef.current?.paused) audioRef.current?.pause();
    }
  }, [audioSource]);

  useEffect(() => {
    const handleProjectionInterruption = (event: Event) => {
      const audio = audioRef.current;
      if (!audio) return;

      const active = (event as CustomEvent<boolean>).detail;
      if (active) {
        resumeAfterProjectionRef.current = (
          APP.getState().system.audioSource === 'local' && !audio.paused
        );
        if (resumeAfterProjectionRef.current) audio.pause();
        return;
      }

      const shouldResume = resumeAfterProjectionRef.current;
      resumeAfterProjectionRef.current = false;
      if (!shouldResume || APP.getState().system.audioSource !== 'local') return;

      void audio.play().catch(() => {
        setError('Local playback could not be resumed after projection audio ended.');
      });
    };

    window.addEventListener(PROJECTION_AUDIO_INTERRUPTION_EVENT, handleProjectionInterruption);
    return () => window.removeEventListener(PROJECTION_AUDIO_INTERRUPTION_EVENT, handleProjectionInterruption);
  }, []);

  useEffect(() => {
    const handleDucking = (event: Event) => {
      const audio = audioRef.current;
      if (!audio) return;
      const active = (event as CustomEvent<boolean>).detail;
      const target = active ? duckingOutputLevel(getAudioSettings().navigationDuckingAmount) : 1;
      const start = audio.volume;
      const startedAt = performance.now();
      const duration = active ? 200 : 650;
      const ramp = (now: number) => {
        const progress = Math.min((now - startedAt) / duration, 1);
        const eased = progress * progress * (3 - 2 * progress);
        audio.volume = start + (target - start) * eased;
        if (progress < 1) requestAnimationFrame(ramp);
      };
      requestAnimationFrame(ramp);
    };
    window.addEventListener(NAVIGATION_DUCKING_EVENT, handleDucking);
    return () => window.removeEventListener(NAVIGATION_DUCKING_EVENT, handleDucking);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SHUFFLE_KEY, String(shuffle));
    } catch {
      // Playback remains usable when persistent browser storage is disabled.
    }
  }, [shuffle]);

  useEffect(() => {
    try {
      localStorage.setItem(REPEAT_KEY, repeatMode);
    } catch {
      // Playback remains usable when persistent browser storage is disabled.
    }
  }, [repeatMode]);

  const loadDirectory = async (directory: DirectoryHandleWithValues) => {
    const files: File[] = [];
    for await (const entry of directory.values()) {
      if (entry.kind !== 'file') continue;
      const file = await entry.getFile();
      if (isAudioFile(file)) files.push(file);
    }

    files.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
    audioRef.current?.pause();
    releaseUrls();
    const nextTracks = files.map((file) => ({ name: file.name, file, url: URL.createObjectURL(file) }));
    urlsRef.current = nextTracks.map(({ url }) => url);
    setFolderName(directory.name);
    setTracks(nextTracks);
    setCurrentTrack(null);
    shuffleHistoryRef.current = [];
    setPlaying(false);
    setPosition(0);
    setDuration(0);
    resumeAfterProjectionRef.current = false;
    APP.getState().update((state) => { state.system.audioSource = 'carplay'; });
    setError(nextTracks.length ? null : 'No supported audio files were found in this folder.');
    const storedTrack = readStoredTrack();
    if (storedTrack?.kind === 'native') {
      const index = nextTracks.findIndex((track) => track.name === storedTrack.name);
      if (index >= 0) restoreTrack(nextTracks, index);
    }
  };

  useEffect(() => {
    const storedTrack = readStoredTrack();
    if (storedTrack?.kind !== 'backend' || !storedTrack.path) return;
    const separator = storedTrack.path.lastIndexOf('/');
    const folderPath = storedTrack.path.slice(0, separator) || '/';
    void fetch(`${MEDIA_API}/browse?path=${encodeURIComponent(folderPath)}`).then(async (response) => {
      if (!response.ok) return;
      const payload = await response.json() as { name: string; entries: BackendMediaEntry[] };
      const files = payload.entries.filter((entry) => entry.kind === 'file');
      const nextTracks = files.map((entry) => ({
        name: entry.name,
        sourcePath: entry.path,
        url: `${MEDIA_API}/file?path=${encodeURIComponent(entry.path)}`,
      }));
      const index = nextTracks.findIndex((track) => track.sourcePath === storedTrack.path);
      if (index < 0) return;
      setFolderName(payload.name);
      setTracks(nextTracks);
      setError(null);
      restoreTrack(nextTracks, index);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void readSavedDirectory().then(async (directory) => {
      if (cancelled || !directory) return;
      const permission = await directory.queryPermission({ mode: 'read' });
      if (cancelled) return;
      if (permission === 'granted') await loadDirectory(directory);
      else savedDirectoryRef.current = directory;
    }).catch(() => {
      // Persistence is optional; the folder picker remains usable if IndexedDB
      // or persistent file handles are unavailable in this runtime.
    });
    return () => { cancelled = true; };
  }, []);

  const chooseFolder = async () => {
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker) {
      setError('Folder selection is not supported by this browser.');
      return false;
    }

    try {
      let directory = savedDirectoryRef.current;
      if (directory) {
        const permission = await directory.requestPermission({ mode: 'read' });
        if (permission !== 'granted') directory = null;
        savedDirectoryRef.current = null;
      }
      directory ??= await picker.call(window);
      await loadDirectory(directory);
      void saveDirectory(directory).catch(() => undefined);
      return true;
    } catch (pickerError) {
      if (pickerError instanceof DOMException && pickerError.name === 'AbortError') return false;
      setError('V-Link could not open this folder.');
      return false;
    }
  };

  const playTrack = async (index: number, addToShuffleHistory = false) => {
    const audio = audioRef.current;
    const track = tracks[index];
    if (!audio || !track) return;

    // Claim media focus before starting the HTML player so projected music is
    // muted before the first local sample reaches the speakers.
    if (APP.getState().system.carplay.phone) sendCarplayMediaCommand('pause');
    APP.getState().update((state) => { state.system.audioSource = 'local'; });
    if (addToShuffleHistory) {
      if (shuffleHistoryRef.current.at(-1) !== index) shuffleHistoryRef.current.push(index);
    } else {
      shuffleHistoryRef.current = [index];
    }
    setCurrentTrack(index);
    setPosition(0);
    setDuration(0);
    audio.src = track.url;
    storeTrack(track);
    if (isProjectionAudioInterrupted()) {
      resumeAfterProjectionRef.current = true;
      return;
    }
    try {
      await audio.play();
      setError(null);
    } catch {
      APP.getState().update((state) => { state.system.audioSource = 'carplay'; });
      setError(`This browser cannot play ${track.name}.`);
    }
  };

  const loadBackendTracks = async (folder: string, entries: BackendMediaEntry[], index: number) => {
    audioRef.current?.pause();
    releaseUrls();
    const nextTracks = entries.map((entry) => ({
      name: entry.name,
      sourcePath: entry.path,
      url: `${MEDIA_API}/file?path=${encodeURIComponent(entry.path)}`,
    }));
    setFolderName(folder);
    setTracks(nextTracks);
    setCurrentTrack(null);
    setPosition(0);
    setDuration(0);
    setError(null);
    // State updates are asynchronous, so start the selected backend URL here.
    const audio = audioRef.current;
    const track = nextTracks[index];
    if (!audio || !track) return;
    if (APP.getState().system.carplay.phone) sendCarplayMediaCommand('pause');
    APP.getState().update((state) => { state.system.audioSource = 'local'; });
    shuffleHistoryRef.current = [index];
    setCurrentTrack(index);
    audio.src = track.url;
    storeTrack(track);
    if (isProjectionAudioInterrupted()) {
      resumeAfterProjectionRef.current = true;
      return;
    }
    try {
      await audio.play();
    } catch {
      APP.getState().update((state) => { state.system.audioSource = 'carplay'; });
      setError(`This browser cannot play ${track.name}.`);
    }
  };

  const playNext = (fromEnded = false) => {
    if (currentTrack == null) return;
    if (fromEnded && repeatMode === 'one') {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        void audioRef.current.play();
      }
      return;
    }
    if (shuffle && tracks.length > 1) {
      let nextTrack = currentTrack;
      while (nextTrack === currentTrack) nextTrack = Math.floor(Math.random() * tracks.length);
      void playTrack(nextTrack, true);
      return;
    }
    if (currentTrack + 1 < tracks.length) {
      void playTrack(currentTrack + 1);
      return;
    }
    if (repeatMode === 'all' && tracks.length) void playTrack(0);
    else setPlaying(false);
  };

  const playPrevious = () => {
    if (currentTrack == null) return;
    if (shuffle && shuffleHistoryRef.current.length > 1) {
      shuffleHistoryRef.current.pop();
      const previousTrack = shuffleHistoryRef.current.at(-1);
      if (previousTrack != null) void playTrack(previousTrack, true);
      return;
    }
    if (currentTrack > 0) void playTrack(currentTrack - 1);
    else if (audioRef.current) audioRef.current.currentTime = 0;
  };

  const playPlayback = async () => {
    const audio = audioRef.current;
    if (!audio || !audio.paused) return;
    if (isProjectionAudioInterrupted()) {
      resumeAfterProjectionRef.current = true;
      return;
    }
    resumeAfterProjectionRef.current = false;
    try {
      await audio.play();
    } catch {
      setError('Playback could not be resumed.');
    }
  };

  const pausePlayback = () => {
    resumeAfterProjectionRef.current = false;
    const audio = audioRef.current;
    if (audio && !audio.paused) audio.pause();
  };

  const togglePlayback = async () => {
    if (audioRef.current?.paused) await playPlayback();
    else pausePlayback();
  };

  useEffect(() => {
    const handleMediaCommand = (event: Event) => {
      const command = (event as CustomEvent<LocalMediaCommand>).detail;
      switch (command) {
        case 'previous':
          playPrevious();
          break;
        case 'next':
          playNext(false);
          break;
        case 'play':
          void playPlayback();
          break;
        case 'pause':
          pausePlayback();
          break;
        case 'toggle':
          void togglePlayback();
          break;
      }
    };

    eventEmitter.addEventListener(LOCAL_MEDIA_COMMAND_EVENT, handleMediaCommand);
    return () => eventEmitter.removeEventListener(LOCAL_MEDIA_COMMAND_EVENT, handleMediaCommand);
  });

  const value: LocalMediaContextValue = {
    folderName, tracks, currentTrack, error, playing, position, duration, shuffle, repeatMode,
    chooseFolder, loadBackendTracks, playTrack, playNext, playPrevious, togglePlayback,
    toggleShuffle: () => setShuffle((current) => !current),
    cycleRepeat: () => setRepeatMode((current) => current === 'off' ? 'all' : current === 'all' ? 'one' : 'off'),
  };

  return (
    <LocalMediaContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        onEnded={() => playNext(true)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
    </LocalMediaContext.Provider>
  );
};

export const useLocalMedia = () => {
  const context = useContext(LocalMediaContext);
  if (!context) throw new Error('useLocalMedia must be used inside LocalMediaProvider');
  return context;
};

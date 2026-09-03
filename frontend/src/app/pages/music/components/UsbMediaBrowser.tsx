import { useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from 'styled-components';

import { APP, useThemeColor } from '@/store/Store';

import {
  UsbBrowserActions,
  UsbBrowserButton,
  UsbBrowserHeader,
  UsbBrowserPage,
  UsbEmptyMessage,
  UsbTrackButton,
  UsbTrackList,
} from '../styles';
import { type BackendMediaEntry, useLocalMedia } from '../LocalMediaProvider';

interface UsbMediaBrowserProps {
  onClose: () => void;
  onTrackSelected: () => void;
}

const MEDIA_API = 'http://localhost:4001/api/media';

const UsbMediaBrowser = ({ onClose, onTrackSelected }: UsbMediaBrowserProps) => {
  const theme = useTheme();
  const themeColor = useThemeColor();
  const accent = theme.colors.theme[themeColor].active;
  const { folderName, tracks, currentTrack, error, playing, chooseFolder, loadBackendTracks, playTrack } = useLocalMedia();
  const [backendEntries, setBackendEntries] = useState<BackendMediaEntry[] | null>(null);
  const [browserTitle, setBrowserTitle] = useState('Media locations');
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const keyStroke = APP((state) => state.keyStroke);
  const bindings = APP((state) => state.settings.dongle_bindings as Record<string, { value?: string }> | undefined);
  const [selectedTrack, setSelectedTrack] = useState(currentTrack ?? 0);
  const trackRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const handledStrokeRef = useRef(false);

  const chooseNativeFolder = useCallback(async () => {
    const loaded = await chooseFolder();
    if (!loaded) return;

    setBackendEntries(null);
    setPathHistory([]);
    setBrowserError(null);
    setSelectedTrack(0);
  }, [chooseFolder]);

  const openBackendDirectory = async (path: string, addToHistory = true) => {
    try {
      const response = await fetch(`${MEDIA_API}/browse?path=${encodeURIComponent(path)}`);
      if (!response.ok) throw new Error();
      const payload = await response.json() as { name: string; path: string; entries: BackendMediaEntry[] };
      if (addToHistory) setPathHistory((current) => [...current, payload.path]);
      setBrowserTitle(payload.name);
      setBackendEntries(payload.entries);
      setSelectedTrack(0);
      setBrowserError(null);
    } catch {
      setBrowserError('V-Link could not open this location.');
    }
  };

  useEffect(() => {
    void fetch(`${MEDIA_API}/roots`).then(async (response) => {
      if (!response.ok) throw new Error();
      const roots = await response.json() as Array<{ name: string; path: string }>;
      setBackendEntries(roots.map((root) => ({ ...root, kind: 'directory' })));
      setBrowserError(roots.length ? null : 'No media locations are mounted.');
    }).catch(() => {
      // Development browsers can keep using the native directory picker.
      setBackendEntries(null);
    });
  }, []);

  const goBack = () => {
    if (!backendEntries || pathHistory.length === 0) {
      onClose();
      return;
    }
    if (pathHistory.length === 1) {
      setPathHistory([]);
      setBrowserTitle('Media locations');
      void fetch(`${MEDIA_API}/roots`).then(async (response) => {
        const roots = await response.json() as Array<{ name: string; path: string }>;
        setBackendEntries(roots.map((root) => ({ ...root, kind: 'directory' })));
      });
      return;
    }
    const previous = pathHistory[pathHistory.length - 2];
    setPathHistory((current) => current.slice(0, -1));
    void openBackendDirectory(previous, false);
  };

  useEffect(() => {
    const itemCount = backendEntries?.length ?? tracks.length;
    if (!itemCount) {
      setSelectedTrack(0);
      return;
    }
    setSelectedTrack((current) => Math.min(current, itemCount - 1));
  }, [backendEntries?.length, tracks.length]);

  useEffect(() => {
    trackRefs.current[selectedTrack]?.scrollIntoView({ block: 'nearest' });
  }, [selectedTrack]);

  useEffect(() => {
    if (!keyStroke) {
      handledStrokeRef.current = false;
      return;
    }
    if (handledStrokeRef.current) return;
    handledStrokeRef.current = true;
    if (keyStroke === bindings?.back?.value) {
      onClose();
    } else if (!backendEntries && !tracks.length && keyStroke === bindings?.selectDown?.value) {
      void chooseNativeFolder();
    } else if (!(backendEntries?.length ?? tracks.length)) {
      return;
    } else if (keyStroke === bindings?.left?.value) {
      const count = backendEntries?.length ?? tracks.length;
      setSelectedTrack((current) => (current - 1 + count) % count);
    } else if (keyStroke === bindings?.right?.value) {
      const count = backendEntries?.length ?? tracks.length;
      setSelectedTrack((current) => (current + 1) % count);
    } else if (keyStroke === bindings?.selectDown?.value) {
      const entry = backendEntries?.[selectedTrack];
      if (!entry) {
        void playTrack(selectedTrack);
        onTrackSelected();
      } else if (entry.kind === 'directory') {
        void openBackendDirectory(entry.path);
      } else {
        const files = backendEntries.filter((item) => item.kind === 'file');
        void loadBackendTracks(browserTitle, files, files.findIndex((item) => item.path === entry.path));
        onTrackSelected();
      }
    }
  }, [backendEntries, bindings, browserTitle, chooseNativeFolder, keyStroke, loadBackendTracks, onClose, onTrackSelected, playTrack, selectedTrack, tracks.length]);

  const visibleEntries = backendEntries;

  return (
    <UsbBrowserPage>
      <UsbBrowserHeader>
        <div>
          <strong>{visibleEntries ? browserTitle : folderName}</strong>
          <span>{visibleEntries ? `${visibleEntries.length} items` : tracks.length ? `${tracks.length} audio files` : 'Choose a local media folder'}</span>
        </div>
        <UsbBrowserActions>
          <UsbBrowserButton type="button" onClick={goBack}>Back</UsbBrowserButton>
          <UsbBrowserButton type="button" $accent={accent} onClick={() => void chooseNativeFolder()}>Choose folder</UsbBrowserButton>
        </UsbBrowserActions>
      </UsbBrowserHeader>

      {(browserError || error) && <UsbEmptyMessage>{browserError || error}</UsbEmptyMessage>}
      {!error && tracks.length === 0 && <UsbEmptyMessage>Select a folder to view its music.</UsbEmptyMessage>}

      <UsbTrackList>
        {visibleEntries?.map((entry, index) => (
          <UsbTrackButton
            key={entry.path}
            type="button"
            $active={false}
            $focused={selectedTrack === index}
            $accent={accent}
            onClick={() => {
              if (entry.kind === 'directory') {
                void openBackendDirectory(entry.path);
                return;
              }
              const files = visibleEntries.filter((item) => item.kind === 'file');
              const index = files.findIndex((item) => item.path === entry.path);
              void loadBackendTracks(browserTitle, files, index);
              onTrackSelected();
            }}
          >
            <span>{entry.kind === 'directory' ? '▸' : '♪'}</span>
            <strong>{entry.name.replace(/\.[^.]+$/, '')}</strong>
          </UsbTrackButton>
        ))}
        {!visibleEntries && tracks.map((track, index) => (
          <UsbTrackButton
            ref={(element) => { trackRefs.current[index] = element; }}
            key={`${track.name}-${track.file?.lastModified ?? track.url}`}
            type="button"
            $active={currentTrack === index}
            $focused={selectedTrack === index}
            $accent={accent}
            onClick={() => {
              setSelectedTrack(index);
              void playTrack(index);
              onTrackSelected();
            }}
          >
            <span>{currentTrack === index && playing ? '▶' : '♪'}</span>
            <strong>{track.name.replace(/\.[^.]+$/, '')}</strong>
          </UsbTrackButton>
        ))}
      </UsbTrackList>
    </UsbBrowserPage>
  );
};

export default UsbMediaBrowser;

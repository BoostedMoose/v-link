import type { CarplayMediaState, ProjectionSource } from '@/carplay/mediaState';
import { sendCarplayMediaCommand } from '@/carplay/mediaCommands';
import { APP, useThemeColor } from '@/store/Store';
import { useEffect, useRef, useState } from 'react';
import { useTheme } from 'styled-components';

import {
  Album, AlbumArt, AlbumPlaceholder, AppName, Artist, ControlButton, Controls,
  Details, EmptyCopy, EmptyState, MusicPage, Progress, ProgressFill,
  ProgressTrack, Time, TimeRow, Title, EmptyOptionRow, EmptyOptions,
  UsbMediaOption, UsbMediaTile, UsbPlayerBackButton, UsbPlayerSourceRow,
} from '../styles';
import { clampProgress, formatTime, getArtworkSource } from '../utils';
import UsbMediaBrowser from './UsbMediaBrowser';
import NativePlayer from './NativePlayer';
import { useLocalMedia } from '../LocalMediaProvider';

interface NowPlayingProps {
  media: CarplayMediaState;
  phoneConnected: boolean;
  source: ProjectionSource;
}

const PreviousIcon = () => <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 7v18M25 8 11 16l14 8V8Z" /></svg>;
const NextIcon = () => <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M24 7v18M7 8l14 8-14 8V8Z" /></svg>;
const PlayPauseIcon = ({ playing }: { playing: boolean }) => (
  <svg viewBox="0 0 32 32" aria-hidden="true">
    {playing ? <path d="M10 8h4v16h-4zM18 8h4v16h-4z" /> : <path d="m11 7 14 9-14 9V7Z" />}
  </svg>
);
const FolderIcon = () => (
  <svg viewBox="0 0 32 32" aria-hidden="true">
    <path d="M4.5 9.5A2.5 2.5 0 0 1 7 7h6l3 3h9a2.5 2.5 0 0 1 2.5 2.5v11A2.5 2.5 0 0 1 25 26H7a2.5 2.5 0 0 1-2.5-2.5v-14Z" />
  </svg>
);

const PROJECTED_MEDIA_COMMANDS = ['prev', 'playOrPause', 'next'] as const;

const NowPlaying = ({ media, phoneConnected, source }: NowPlayingProps) => {
  const theme = useTheme();
  const themeColor = useThemeColor();
  const accent = theme.colors.theme[themeColor].active;
  const hasMedia = Boolean(media.title || media.artist || media.album || media.artworkBase64);
  const artworkSource = getArtworkSource(media.artworkBase64);
  const playing = media.playbackStatus > 0;
  const [usbBrowserOpen, setUsbBrowserOpen] = useState(false);
  const localMedia = useLocalMedia();
  const localTrack = localMedia.currentTrack == null ? null : localMedia.tracks[localMedia.currentTrack];
  const localAudioActive = APP((state) => state.system.audioSource === 'local');
  const keyStroke = APP((state) => state.keyStroke);
  const bindings = APP((state) => state.settings.dongle_bindings as Record<string, { value?: string }> | undefined);
  const [focusedProjectedControl, setFocusedProjectedControl] = useState(1);
  const handledStrokeRef = useRef(false);

  useEffect(() => {
    if (!keyStroke) {
      handledStrokeRef.current = false;
      return;
    }
    if (handledStrokeRef.current || usbBrowserOpen) return;
    handledStrokeRef.current = true;
    if (keyStroke === bindings?.down?.value) {
      setUsbBrowserOpen(true);
    } else if (localAudioActive && localTrack) {
      return;
    } else if (phoneConnected && keyStroke === bindings?.left?.value) {
      setFocusedProjectedControl((current) => (current - 1 + PROJECTED_MEDIA_COMMANDS.length) % PROJECTED_MEDIA_COMMANDS.length);
    } else if (phoneConnected && keyStroke === bindings?.right?.value) {
      setFocusedProjectedControl((current) => (current + 1) % PROJECTED_MEDIA_COMMANDS.length);
    } else if (phoneConnected && keyStroke === bindings?.selectDown?.value) {
      sendCarplayMediaCommand(PROJECTED_MEDIA_COMMANDS[focusedProjectedControl]);
    }
  }, [bindings, focusedProjectedControl, keyStroke, localAudioActive, localTrack, phoneConnected, usbBrowserOpen]);

  if (usbBrowserOpen) {
    return <UsbMediaBrowser onClose={() => setUsbBrowserOpen(false)} onTrackSelected={() => setUsbBrowserOpen(false)} />;
  }
  if (localAudioActive && localTrack) {
    return (
      <NativePlayer
          title={localTrack.name.replace(/\.[^.]+$/, '')}
          folderName={localMedia.folderName}
          playing={localMedia.playing}
          position={localMedia.position}
          duration={localMedia.duration}
          shuffle={localMedia.shuffle}
          repeatMode={localMedia.repeatMode}
          onBrowse={() => setUsbBrowserOpen(true)}
          onToggleShuffle={localMedia.toggleShuffle}
          onCycleRepeat={localMedia.cycleRepeat}
          onPrevious={localMedia.playPrevious}
          onPlayPause={() => void localMedia.togglePlayback()}
          onNext={() => localMedia.playNext(false)}
      />
    );
  }

  if (!phoneConnected) {
    return (
      <EmptyState>
        <EmptyOptions>
          <EmptyOptionRow>
            <AlbumPlaceholder $compact aria-hidden="true">♪</AlbumPlaceholder>
            <EmptyCopy>
              <strong>Nothing playing</strong>
              <span>Connect CarPlay or Android Auto to control playback.</span>
            </EmptyCopy>
          </EmptyOptionRow>
          <UsbMediaOption type="button" $focused onClick={() => setUsbBrowserOpen(true)}>
            <UsbMediaTile aria-hidden="true"><FolderIcon /></UsbMediaTile>
            <EmptyCopy>
              <strong>Local Media</strong>
              <span>Browse a folder and play music stored on this device.</span>
            </EmptyCopy>
          </UsbMediaOption>
        </EmptyOptions>
      </EmptyState>
    );
  }

  return (
    <MusicPage>
      <AlbumArt>
        {artworkSource ? <img src={artworkSource} alt="" /> : <AlbumPlaceholder aria-hidden="true">♪</AlbumPlaceholder>}
      </AlbumArt>
      <Details>
        <UsbPlayerSourceRow>
          <AppName style={{ color: accent }}>{media.appName || source || 'Phone projection'}</AppName>
          <UsbPlayerBackButton type="button" onClick={() => setUsbBrowserOpen(true)}>Local media</UsbPlayerBackButton>
        </UsbPlayerSourceRow>
        <Title>{media.title || 'Now Playing'}</Title>
        <Artist>{media.artist || (hasMedia ? 'Unknown artist' : 'Metadata unavailable')}</Artist>
        {media.album && <Album>{media.album}</Album>}
        {hasMedia && (
          <Progress>
            <ProgressTrack>
              <ProgressFill $progress={clampProgress(media.positionMs, media.durationMs)} $color={accent} />
            </ProgressTrack>
            <TimeRow><Time>{formatTime(media.positionMs)}</Time><Time>{formatTime(media.durationMs)}</Time></TimeRow>
          </Progress>
        )}
        <Controls>
          <ControlButton type="button" $focused={focusedProjectedControl === 0} $color={accent} aria-label="Anterior" onClick={() => sendCarplayMediaCommand('prev')}><PreviousIcon /></ControlButton>
          <ControlButton type="button" $focused={focusedProjectedControl === 1} $primary $color={accent} aria-label={playing ? 'Pausar' : 'Reproducir'} onClick={() => sendCarplayMediaCommand('playOrPause')}>
            <PlayPauseIcon playing={playing} />
          </ControlButton>
          <ControlButton type="button" $focused={focusedProjectedControl === 2} $color={accent} aria-label="Siguiente" onClick={() => sendCarplayMediaCommand('next')}><NextIcon /></ControlButton>
        </Controls>
      </Details>
    </MusicPage>
  );
};

export default NowPlaying;

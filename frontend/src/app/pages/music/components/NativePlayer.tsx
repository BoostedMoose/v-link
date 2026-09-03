import { useEffect, useRef, useState } from 'react';
import { useTheme } from 'styled-components';

import { APP, useThemeColor } from '@/store/Store';

import {
  AlbumArt,
  AlbumPlaceholder,
  AppName,
  Artist,
  ControlButton,
  Controls,
  Details,
  MusicPage,
  Progress,
  ProgressFill,
  ProgressTrack,
  Time,
  TimeRow,
  Title,
  UsbPlayerBackButton,
  UsbPlayerSourceRow,
} from '../styles';
import { clampProgress, formatTime } from '../utils';

interface NativePlayerProps {
  title: string;
  folderName: string;
  playing: boolean;
  position: number;
  duration: number;
  shuffle: boolean;
  repeatMode: 'off' | 'all' | 'one';
  onBrowse: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onPrevious: () => void;
  onPlayPause: () => void;
  onNext: () => void;
}

const PreviousIcon = () => <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 7v18M25 8 11 16l14 8V8Z" /></svg>;
const NextIcon = () => <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M24 7v18M7 8l14 8-14 8V8Z" /></svg>;
const PlayPauseIcon = ({ playing }: { playing: boolean }) => (
  <svg viewBox="0 0 32 32" aria-hidden="true">
    {playing ? <path d="M10 8h4v16h-4zM18 8h4v16h-4z" /> : <path d="m11 7 14 9-14 9V7Z" />}
  </svg>
);
const ShuffleIcon = () => (
  <svg viewBox="0 0 32 32" aria-hidden="true">
    <path d="M5 9h4c6 0 8 14 14 14h4m-4-4 4 4-4 4M5 23h4c2.5 0 4.2-2.4 5.8-5.2M20 9c1-.6 2-.9 3-.9h4m-4-4 4 4-4 4" fill="none" />
  </svg>
);
const RepeatIcon = ({ mode }: { mode: 'off' | 'all' | 'one' }) => (
  <svg viewBox="0 0 32 32" aria-hidden="true">
    <path d="M24 8H10a5 5 0 0 0-5 5v1m3-3-3 3-3-3M8 24h14a5 5 0 0 0 5-5v-1m-3 3 3-3 3 3" fill="none" />
    {mode === 'one' && <text x="16" y="20" textAnchor="middle">1</text>}
  </svg>
);

const NativePlayer = ({
  title,
  folderName,
  playing,
  position,
  duration,
  shuffle,
  repeatMode,
  onBrowse,
  onToggleShuffle,
  onCycleRepeat,
  onPrevious,
  onPlayPause,
  onNext,
}: NativePlayerProps) => {
  const theme = useTheme();
  const themeColor = useThemeColor();
  const accent = theme.colors.theme[themeColor].active;
  const remaining = Math.max(duration - position, 0);
  const keyStroke = APP((state) => state.keyStroke);
  const bindings = APP((state) => state.settings.dongle_bindings as Record<string, { value?: string }> | undefined);
  const [focusedControl, setFocusedControl] = useState(2);
  const handledStrokeRef = useRef(false);

  useEffect(() => {
    if (!keyStroke) {
      handledStrokeRef.current = false;
      return;
    }
    if (handledStrokeRef.current) return;
    handledStrokeRef.current = true;
    if (keyStroke === bindings?.left?.value) {
      setFocusedControl((current) => (current - 1 + 5) % 5);
    } else if (keyStroke === bindings?.right?.value) {
      setFocusedControl((current) => (current + 1) % 5);
    } else if (keyStroke === bindings?.selectDown?.value) {
      [onToggleShuffle, onPrevious, onPlayPause, onNext, onCycleRepeat][focusedControl]();
    } else if (keyStroke === bindings?.back?.value) {
      onBrowse();
    }
  }, [bindings, focusedControl, keyStroke, onBrowse, onCycleRepeat, onNext, onPlayPause, onPrevious, onToggleShuffle]);

  return (
    <MusicPage>
      <AlbumArt><AlbumPlaceholder aria-hidden="true">♪</AlbumPlaceholder></AlbumArt>
      <Details>
        <UsbPlayerSourceRow>
          <AppName style={{ color: accent }}>Local Media</AppName>
          <UsbPlayerBackButton type="button" onClick={onBrowse}>Browse files</UsbPlayerBackButton>
        </UsbPlayerSourceRow>
        <Title>{title}</Title>
        <Artist>{folderName}</Artist>
        <Progress>
          <ProgressTrack><ProgressFill $progress={clampProgress(position, duration)} $color={accent} /></ProgressTrack>
          <TimeRow>
            <Time>{duration > 0 ? `-${formatTime(remaining * 1000)}` : '--:--'}</Time>
            <Time>{duration > 0 ? formatTime(duration * 1000) : '--:--'}</Time>
          </TimeRow>
        </Progress>
        <Controls>
          <ControlButton type="button" $focused={focusedControl === 0} $active={shuffle} $color={accent} aria-label={shuffle ? 'Disable shuffle' : 'Enable shuffle'} onClick={onToggleShuffle}><ShuffleIcon /></ControlButton>
          <ControlButton type="button" $focused={focusedControl === 1} $color={accent} aria-label="Previous" onClick={onPrevious}><PreviousIcon /></ControlButton>
          <ControlButton type="button" $focused={focusedControl === 2} $primary $color={accent} aria-label={playing ? 'Pause' : 'Play'} onClick={onPlayPause}>
            <PlayPauseIcon playing={playing} />
          </ControlButton>
          <ControlButton type="button" $focused={focusedControl === 3} $color={accent} aria-label="Next" onClick={onNext}><NextIcon /></ControlButton>
          <ControlButton
            type="button"
            $focused={focusedControl === 4}
            $active={repeatMode !== 'off'}
            $color={accent}
            aria-label={repeatMode === 'one' ? 'Repeat one track' : repeatMode === 'all' ? 'Repeat folder' : 'Repeat off'}
            onClick={onCycleRepeat}
          >
            <RepeatIcon mode={repeatMode} />
          </ControlButton>
        </Controls>
      </Details>
    </MusicPage>
  );
};

export default NativePlayer;

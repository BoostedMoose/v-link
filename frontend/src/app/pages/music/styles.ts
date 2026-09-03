import styled from 'styled-components';

export const MusicPage = styled.section`
  box-sizing: border-box;
  width: 100%; height: 100%;
  display: grid;
  grid-template-columns: minmax(180px, 38%) minmax(0, 1fr);
  align-items: center;
  gap: clamp(24px, 5vw, 64px);
  padding: clamp(20px, 4vw, 48px);
  overflow: hidden;
  @media (max-width: 560px) {
    grid-template-columns: minmax(120px, 34%) minmax(0, 1fr);
    gap: 18px; padding: 16px;
  }
`;

export const AlbumArt = styled.div`
  width: 100%; aspect-ratio: 1; max-height: 100%;
  border-radius: 18px; overflow: hidden;
  background: ${({ theme }) => theme.colors.dark};
  box-shadow: 0 18px 48px rgb(0 0 0 / 45%);
  img { width: 100%; height: 100%; display: block; object-fit: cover; }
`;

export const AlbumPlaceholder = styled.div<{ $compact?: boolean }>`
  width: ${({ $compact }) => ($compact ? '130px' : '100%')};
  height: ${({ $compact }) => ($compact ? '130px' : '100%')};
  min-height: 120px; display: grid; place-items: center;
  border-radius: ${({ $compact }) => ($compact ? '18px' : '0')};
  color: ${({ theme }) => theme.colors.medium};
  background: ${({ theme }) => theme.colors.gradients.gradient1};
  font: 700 clamp(58px, 10vw, 110px) ${({ theme }) => theme.fonts.spartan};
`;

export const Details = styled.div`min-width: 0; display: flex; flex-direction: column; justify-content: center;`;
export const AppName = styled.span`
  margin-bottom: 10px; letter-spacing: .14em; text-transform: uppercase;
  font: ${({ theme }) => `${theme.fontWeights.semiBold} 11px ${theme.fonts.inter}`};
`;
export const Title = styled.h1`
  margin: 0; overflow: hidden; color: ${({ theme }) => theme.colors.light};
  font: ${({ theme }) => `${theme.fontWeights.bold} clamp(26px, 5vw, 52px) ${theme.fonts.spartan}`};
  line-height: 1.02; text-overflow: ellipsis; white-space: nowrap;
`;
export const Artist = styled.p`
  margin: 10px 0 0; overflow: hidden; color: ${({ theme }) => theme.colors.text};
  font: ${({ theme }) => `${theme.fontWeights.semiBold} clamp(16px, 2.7vw, 25px) ${theme.fonts.inter}`};
  text-overflow: ellipsis; white-space: nowrap;
`;
export const Album = styled.p`
  margin: 5px 0 0; overflow: hidden; color: ${({ theme }) => theme.colors.medium};
  font: ${({ theme }) => `${theme.fontWeights.regular} clamp(13px, 2vw, 18px) ${theme.fonts.inter}`};
  text-overflow: ellipsis; white-space: nowrap;
`;
export const Progress = styled.div`width: 100%; margin-top: clamp(20px, 4vh, 34px);`;
export const ProgressTrack = styled.div`
  height: 4px; overflow: hidden; border-radius: 999px; background: ${({ theme }) => theme.colors.medium};
`;
export const ProgressFill = styled.div<{ $progress: number; $color: string }>`
  width: ${({ $progress }) => `${$progress}%`}; height: 100%; border-radius: inherit;
  background: ${({ $color }) => $color}; box-shadow: ${({ $color }) => `0 0 12px ${$color}`};
  transition: width 300ms linear;
`;
export const TimeRow = styled.div`display: flex; justify-content: space-between; margin-top: 7px;`;
export const Time = styled.span`
  color: ${({ theme }) => theme.colors.medium};
  font: ${({ theme }) => `${theme.fontWeights.regular} 11px ${theme.fonts.inter}`};
`;
export const Controls = styled.div`
  display: flex; align-items: center; justify-content: center;
  gap: clamp(18px, 4vw, 36px); margin-top: clamp(14px, 3vh, 24px);
`;
export const ControlButton = styled.button<{ $primary?: boolean; $active?: boolean; $focused?: boolean; $color?: string }>`
  width: ${({ $primary }) => ($primary ? '68px' : '54px')};
  height: ${({ $primary }) => ($primary ? '68px' : '54px')};
  display: grid; place-items: center; padding: 0;
  border: ${({ $primary, $color }) => ($primary ? `1px solid ${$color}` : '1px solid transparent')};
  border-radius: 50%; color: ${({ theme, $primary, $active, $color }) => ($primary ? theme.colors.bg1 : $active ? $color : theme.colors.light)};
  background: ${({ $primary, $color }) => ($primary ? $color : 'transparent')}; cursor: pointer;
  outline: ${({ $focused, $color }) => $focused ? `2px solid ${$color}` : 'none'};
  outline-offset: 3px;
  svg { width: ${({ $primary }) => ($primary ? '33px' : '29px')}; height: ${({ $primary }) => ($primary ? '33px' : '29px')}; fill: currentColor; stroke: currentColor; stroke-width: 1.5; }
  text { fill: currentColor; stroke: none; font: 700 10px sans-serif; }
  &:active { transform: scale(.94); }
`;
export const EmptyState = styled.section`
  width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; gap: 24px;
`;
export const EmptyOptions = styled.div`
  display: flex; flex-direction: column; gap: 20px;
`;
export const EmptyOptionRow = styled.div`
  display: grid; grid-template-columns: 130px minmax(0, 360px); align-items: center; gap: 24px;
`;
export const EmptyCopy = styled.div`
  display: flex; flex-direction: column; gap: 6px; color: ${({ theme }) => theme.colors.text};
  font-family: ${({ theme }) => theme.fonts.inter};
  strong { font-size: clamp(20px, 4vw, 34px); }
  span { max-width: 360px; color: ${({ theme }) => theme.colors.medium}; font-size: 14px; }
`;
export const UsbMediaOption = styled.button<{ $focused?: boolean }>`
  display: grid; grid-template-columns: 130px minmax(0, 360px); align-items: center; gap: 24px;
  padding: 0; border: 0; color: inherit; background: transparent; text-align: left; cursor: pointer;
  outline: ${({ $focused, theme }) => $focused ? `2px solid ${theme.colors.medium}` : 'none'};
  outline-offset: 6px; border-radius: 18px;
  &:active { transform: scale(.985); }
`;
export const UsbMediaTile = styled.div`
  width: 130px; height: 130px; min-height: 120px; display: grid; place-items: center;
  border-radius: 18px; color: ${({ theme }) => theme.colors.medium};
  background: ${({ theme }) => theme.colors.gradients.gradient1};
  svg { width: clamp(58px, 10vw, 110px); height: clamp(58px, 10vw, 110px); fill: none; stroke: currentColor; stroke-width: 1.35; stroke-linecap: round; stroke-linejoin: round; }
`;

export const UsbBrowserPage = styled.section`
  box-sizing: border-box; width: 100%; height: 100%; padding: clamp(18px, 4vw, 38px);
  display: flex; flex-direction: column; gap: 18px; overflow: hidden;
`;
export const UsbBrowserHeader = styled.header`
  display: flex; align-items: center; justify-content: space-between; gap: 18px;
  color: ${({ theme }) => theme.colors.light}; font-family: ${({ theme }) => theme.fonts.inter};
  div:first-child { display: flex; min-width: 0; flex-direction: column; gap: 4px; }
  strong { overflow: hidden; font-size: clamp(20px, 3vw, 30px); text-overflow: ellipsis; white-space: nowrap; }
  span { color: ${({ theme }) => theme.colors.medium}; font-size: 13px; }
`;
export const UsbBrowserActions = styled.div`display: flex; gap: 10px;`;
export const UsbBrowserButton = styled.button<{ $accent?: string }>`
  padding: 10px 14px; border: 1px solid ${({ $accent, theme }) => $accent || theme.colors.medium};
  border-radius: 10px; color: ${({ $accent, theme }) => $accent ? theme.colors.bg1 : theme.colors.light};
  background: ${({ $accent }) => $accent || 'transparent'}; cursor: pointer;
  font: ${({ theme }) => `${theme.fontWeights.semiBold} 12px ${theme.fonts.inter}`};
`;
export const UsbTrackList = styled.div`
  min-height: 0; display: flex; flex-direction: column; gap: 6px; overflow-y: auto;
`;
export const UsbTrackButton = styled.button<{ $active: boolean; $focused: boolean; $accent: string }>`
  width: 100%; display: grid; grid-template-columns: 28px minmax(0, 1fr); align-items: center;
  gap: 10px; padding: 12px 14px; border: 0; border-radius: 10px; text-align: left;
  color: ${({ $active, $accent, theme }) => $active ? $accent : theme.colors.text};
  background: ${({ $active, theme }) => $active ? theme.colors.dark : 'transparent'}; cursor: pointer;
  outline: ${({ $focused, $accent }) => $focused ? `2px solid ${$accent}` : 'none'};
  outline-offset: -2px;
  span { text-align: center; }
  strong { overflow: hidden; font: ${({ theme }) => `${theme.fontWeights.semiBold} 14px ${theme.fonts.inter}`}; text-overflow: ellipsis; white-space: nowrap; }
`;
export const UsbEmptyMessage = styled.p`
  margin: auto; color: ${({ theme }) => theme.colors.medium};
  font: ${({ theme }) => `${theme.fontWeights.regular} 14px ${theme.fonts.inter}`};
`;
export const UsbPlayerSourceRow = styled.div`
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  ${AppName} { margin-bottom: 0; }
`;
export const UsbPlayerBackButton = styled.button`
  padding: 7px 10px; border: 1px solid ${({ theme }) => theme.colors.medium}; border-radius: 9px;
  color: ${({ theme }) => theme.colors.text}; background: transparent; cursor: pointer;
  font: ${({ theme }) => `${theme.fontWeights.semiBold} 11px ${theme.fonts.inter}`};
`;

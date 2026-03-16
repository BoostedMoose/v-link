import styled from 'styled-components';
import React from 'react';

/* ========= Styled Components ========= */

interface SliderContainerProps {
  $width?: string;
}

interface TrackProps {
  backgroundColor?: string;
}

interface FillProps {
  percent: number;
  fillColor?: string;
}

interface ThumbProps {
  percent: number;
  thumbColor?: string;
}

const SliderContainer = styled.div<SliderContainerProps>`
  width: ${({ $width }) => $width || '100%'};
  height: ${({ theme }) => theme.interaction.buttonHeight}px;
  display: flex;
  align-items: center;
  position: relative;
  padding: 0 9px;
  box-sizing: border-box;
`;

const Track = styled.div<TrackProps>`
  position: relative;
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background-color: ${({ theme, backgroundColor }) =>
    backgroundColor || theme.colors.medium};
`;

const Fill = styled.div<FillProps>`
  position: absolute;
  height: 100%;
  border-radius: 3px;
  width: ${({ percent }) => percent}%;
  background-color: ${({ theme, fillColor }) =>
    fillColor || theme.colors.theme.white.default};
`;

const Thumb = styled.div<ThumbProps>`
  position: absolute;
  top: 50%;
  left: ${({ percent }) => percent}%;
  transform: translate(-50%, -50%);
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background-color: ${({ theme, thumbColor }) =>
    thumbColor || theme.colors.theme.white.active};
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.4);
  pointer-events: none; /* El input invisible captura el drag */
`;

/* Invisible input that actually manages the slider */
const HiddenRange = styled.input`
  position: absolute;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
`;

/* ========= Components ========= */

interface CustomSliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  backgroundColor?: string;
  defaultColor?: string;
  activeColor?: string;
  width?: string;
}

export default function CustomSlider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  backgroundColor,
  defaultColor,
  activeColor,
  width
}: CustomSliderProps) {
  const safeMin = Number.isFinite(Number(min)) ? Number(min) : 0;
  const safeMax = Number.isFinite(Number(max)) ? Number(max) : 100;
  const clampedValue = Number.isFinite(Number(value)) ? Number(value) : safeMin;
  const safeValue = Math.min(Math.max(clampedValue, safeMin), safeMax);

  /* Visual percentage calculation  */
  const percent =
    safeMax > safeMin
      ? ((safeValue - safeMin) / (safeMax - safeMin)) * 100
      : 0;

  return (
    <SliderContainer $width={width}>
      <Track backgroundColor={backgroundColor}>
        <Fill percent={percent} fillColor={defaultColor} />
        <Thumb percent={percent} thumbColor={activeColor} />
      </Track>

      <HiddenRange
        type="range"
        min={safeMin}
        max={safeMax}
        step={step}
        value={safeValue}
        onChange={onChange}
      />
    </SliderContainer>
  );
}

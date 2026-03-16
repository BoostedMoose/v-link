import styled from 'styled-components';
import hexToRgba from '@/app/helper/HexToRGBA'

interface BaseIconProps {
  isActive?: boolean;
  color?: string;
  activeColor?: string;
  inactiveColor?: string;
  defaultColor?: string;
  glowColor?: string;
}

export const IconSmall = styled.svg<Pick<BaseIconProps, 'isActive'>>`
    fill: none;
    stroke-width: 3px;
    width: ${({ theme }) => theme.icons.small};
    height: ${({ theme }) => theme.icons.small};
    stroke: ${({ theme, isActive }) =>
        isActive ? theme.colors.light : theme.colors.medium};
    transition: stroke 1s ease-in-out;
`;

export const IconMedium = styled.svg<BaseIconProps>`
    width: ${({ theme }) => theme.icons.medium};
    height: ${({ theme }) => theme.icons.medium};
    fill: none;
    stroke-width: 3px;
    stroke: ${({ isActive, color, activeColor, inactiveColor }) =>
        color ? color : isActive ? activeColor : inactiveColor};
    transition: fill 0.3s ease-in-out;
    filter: ${({ isActive, activeColor }) =>
        isActive ? `drop-shadow(${activeColor})` : 'none'};
`;

export const IconLarge = styled.svg<BaseIconProps>`
    width: ${({ theme }) => theme.icons.large};
    height: ${({ theme }) => theme.icons.large};
    fill:none;
    stroke: ${({ isActive, color, activeColor, inactiveColor }) =>
        color ? color : isActive ? activeColor : inactiveColor};
    transition: fill 0.3s ease-in-out;
    filter: ${({ isActive, theme }) =>
        isActive ? `drop-shadow(${theme.colors.theme.blue.navGlow})` : 'none'};
    &:hover {
        fill: ${({ isActive, activeColor, defaultColor }) =>
        isActive ? activeColor : defaultColor};
        filter: ${({ isActive, activeColor }) =>
        isActive ? `drop-shadow(${activeColor})` : 'none'};
    }
`;

interface ExtraLargeIconProps {
  isActive?: boolean;
  activeColor?: string;
  defaultColor?: string;
  color?: string;
}

export const IconExtraLarge = styled.svg<ExtraLargeIconProps>`
    width: ${({ theme }) => theme.icons.xlarge};
    height: ${({ theme }) => theme.icons.xlarge};
    fill: ${({ isActive, activeColor, defaultColor }) =>
        isActive ? activeColor : defaultColor};
    transition: fill 0.3s ease-in-out;
    filter: ${({ color }) =>
        `drop-shadow(0 0px 100px ${hexToRgba(color ?? 'transparent', 1)})
        `};
    &:hover {
        fill: ${({ defaultColor }) => defaultColor};
    }
`;

export const IconNav = styled.svg<BaseIconProps>`
stroke-linecap: round;
    fill: none;
    width: ${({ theme }) => theme.icons.large};
    height: ${({ theme }) => theme.icons.large};
    stroke-width: 2.5px;
    stroke: ${({ isActive, activeColor, defaultColor }) =>
        isActive ? activeColor : defaultColor};
    transition: fill 0.3s ease-in-out;
    filter: ${({ isActive, glowColor }) =>
        isActive ? `drop-shadow(${glowColor})` : 'none'};
    &:hover {
        stroke: ${({ isActive, activeColor, defaultColor }) =>
        isActive ? activeColor : defaultColor};
        filter: ${({ isActive, defaultColor }) =>
        isActive ? `drop-shadow(${defaultColor})` : 'none'};
    }
`;

interface CustomIconProps {
  size?: number;
  stroke?: number;
  isActive?: boolean;
  color?: string;
  activeColor?: string;
  inactiveColor?: string;
  defaultColor?: string;
  glowColor?: string;
  fill?: string;
  theme?: object;
}

export const CustomIcon = styled.svg<CustomIconProps>`
    width: ${({ size }) => size}px;
    height: ${({ size }) => size}px;
    overflow: visible;
    stroke-width: ${({ stroke }) => stroke};
    stroke-linecap: round;
    fill: none;
    stroke: ${({ isActive, color, activeColor, defaultColor }) =>
        color ? color : isActive ? activeColor : defaultColor};
    transition: fill 0.3s ease-in-out;
    filter: ${({ isActive, glowColor }) =>
        isActive ? `drop-shadow(${glowColor})` : 'none'};
`;

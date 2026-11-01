import styled from 'styled-components';
import hexToRgba from '../../app/helper/HexToRGBA'

export const Fade = styled.div`
    flex: 1;

    display: flex;
    flex-direction: column;

    height: 100%;
    width: 100%;

    overflow: hidden;

    opacity: 0;
    transition: opacity ${({ fadeLength }) => `${fadeLength}s`} ease-in;

    &.fade-in {
        opacity: 1;
    }

    &.fade-out {
        opacity: 0;
    }
`;

export const GlowLarge = styled.div`
  box-shadow: 0 0 50px ${({ color, opacity }) => hexToRgba(color, opacity)};

  transition: box-shadow 0.4s ease-in-out;
  background: none;
`;
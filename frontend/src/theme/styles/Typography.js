import styled from 'styled-components';

// Display
export const Display4 = styled.h1`
    color: ${({ theme }) => theme.colors.light};
    margin: 0;
    font-family: ${({ theme }) => theme.typography.display4.fontFamily};
    font-weight: ${({ theme }) => theme.typography.display4.fontWeight};
    font-size: ${({ theme }) => theme.typography.display4.fontSize};
`;

export const Display3 = styled.h2`
    color: ${({ theme }) => theme.colors.light};
    font-family: ${({ theme }) => theme.typography.display3.fontFamily};
    font-weight: ${({ theme }) => theme.typography.display3.fontWeight};
    font-size: ${({ theme }) => theme.typography.display3.fontSize};
`;

export const Display2 = styled.h3`
    color: ${({ theme }) => theme.colors.light};
    font-family: ${({ theme }) => theme.typography.display2.fontFamily};
    font-weight: ${({ theme }) => theme.typography.display2.fontWeight};
    font-size: ${({ theme }) => theme.typography.display2.fontSize};
`;

export const Display1 = styled.h4`
    color: ${({ theme }) => theme.colors.light};
    font-family: ${({ theme }) => theme.typography.display1.fontFamily};
    font-weight: ${({ theme }) => theme.typography.display1.fontWeight};
    font-size: ${({ theme }) => theme.typography.display1.fontSize};
`;

// Title and Subtitle
export const Title = styled.h5`
    color: ${({ theme }) => theme.colors.light};
    font-family: ${({ theme }) => theme.typography.title.fontFamily};
    font-weight: ${({ theme }) => theme.typography.title.fontWeight};
    font-size: ${({ theme }) => theme.typography.title.fontSize};
`;

export const Subtitle = styled.h6`
    color: ${({ theme }) => theme.colors.light};
    font-family: ${({ theme }) => theme.typography.subtitle.fontFamily};
    font-weight: ${({ theme }) => theme.typography.subtitle.fontWeight};
    font-size: ${({ theme }) => theme.typography.subtitle.fontSize};
`;

// Body
export const Body2 = styled.p`
    color: ${({ theme }) => theme.colors.light};
    font-family: ${({ theme }) => theme.typography.body2.fontFamily};
    font-weight: ${({ theme }) => theme.typography.body2.fontWeight};
    font-size: ${({ theme }) => theme.typography.body2.fontSize};
`;

export const Body1 = styled.p`
    color: ${({ theme }) => theme.colors.light};
    font-family: ${({ theme }) => theme.typography.body1.fontFamily};
    font-weight: ${({ theme }) => theme.typography.body1.fontWeight};
    font-size: ${({ theme }) => theme.typography.body1.fontSize};
`;

// Captions
export const Caption2 = styled.span`
    color: ${({ theme }) => theme.colors.light};
    font-family: ${({ theme }) => theme.typography.caption2.fontFamily};
    font-weight: ${({ theme }) => theme.typography.caption2.fontWeight};
    font-size: ${({ theme }) => theme.typography.caption2.fontSize};
`;

export const Caption1 = styled.span`
    color: ${({ theme }) => theme.colors.light};
    font-family: ${({ theme }) => theme.typography.caption1.fontFamily};
    font-weight: ${({ theme }) => theme.typography.caption1.fontWeight};
    font-size: ${({ theme }) => theme.typography.caption1.fontSize};
`;

// Button
export const ButtonText = styled.span`
    color: ${({ theme }) => theme.colors.light};
    font-family: ${({ theme }) => theme.typography.button.fontFamily};
    font-weight: ${({ theme }) => theme.typography.button.fontWeight};
    font-size: ${({ theme }) => theme.typography.button.fontSize};
`;

export const Typography = {
  Display4,
  Display3,
  Display2,
  Display1,
  Title,
  Subtitle,
  Body2,
  Body1,
  Caption2,
  Caption1,
  ButtonText
}

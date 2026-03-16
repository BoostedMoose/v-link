import 'styled-components';
import type { Keyframes } from 'styled-components';

interface ThemeColor {
  default: string;
  active: string;
  navGlow: string;
  highlightDark: string;
  highlightLight: string;
}

interface TypographyStyle {
  fontFamily: string;
  fontWeight: number;
  fontSize: string;
}

declare module 'styled-components' {
  export interface DefaultTheme {
    animations: {
      getSlideDown: (height: number) => Keyframes;
      getSlideUp: (height: number) => Keyframes;
      getSlideLeft: (width: number) => Keyframes;
      getSlideRight: (width: number) => Keyframes;
      getVerticalExpand: (minHeight: number, maxHeight: number) => Keyframes;
      getVerticalCollapse: (minHeight: number, maxHeight: number) => Keyframes;
      getHorizontalExpand: (minWidth: number, maxWidth: number) => Keyframes;
      getHorizontalCollapse: (minWidth: number, maxWidth: number) => Keyframes;
    };

    fonts: {
      spartan: string;
      inter: string;
    };

    icons: {
      small: string;
      medium: string;
      large: string;
      xlarge: string;
    };

    interaction: {
      toggleHeight: string;
      buttonHeight: string;
      buttonWidth: string;
    };

    colors: {
      button: string;
      navbar: string;
      dark: string;
      medium: string;
      light: string;
      text: string;
      background: string;
      bg1: string;
      bg2: string;
      bg3: string;
      gradients: {
        gradient1: string;
        gradient2: string;
        gradient3: string;
      };
      theme: {
        green: ThemeColor;
        blue: ThemeColor;
        red: ThemeColor;
        white: ThemeColor;
      };
    };

    fontWeights: {
      light: number;
      regular: number;
      semiBold: number;
      bold: number;
    };

    typography: {
      display4: TypographyStyle;
      display3: TypographyStyle;
      display2: TypographyStyle;
      display1: TypographyStyle;
      title: TypographyStyle;
      subtitle: TypographyStyle;
      body2: TypographyStyle;
      body1: TypographyStyle;
      caption2: TypographyStyle;
      caption1: TypographyStyle;
      button: TypographyStyle;
    };
  }
}

import { animations } from './Animations';

export const theme = {
  animations: animations,

  fonts: {
    spartan: "'League Spartan', sans-serif",
    inter: "'Inter 18pt', sans-serif",
  },
  
  icons: {
    small: '14px',
    medium: '18px',
    large: '32px',
    xlarge: '64px',
  },

  interaction: {
    toggleHeight: '20',
    buttonHeight: '40',
    buttonWidth: '200',
  },

  colors: {    
    button: '#090909',
    navbar: '#090909',

    dark: '#202020',
    medium: '#404040',
    light: '#DBDBDB',

    text: '#DBDBDB',
    background: '#141414',
    navbar: '#090909',

    bg1: '#0D0D0D',
    bg2: '#1C1C1C',
    bg3: '#1C1C1C',

    gradients: {
      gradient1: 'linear-gradient(180deg, #1C1C1C,#0D0D0D)',
      gradient2: 'linear-gradient(180deg, #0D0D0D, #1C1C1C)',
      gradient3: 'linear-gradient(180deg, #141414, #0D0D0D)',
    },

    theme: {
      green: {
        default: '#385538',
        active: '#5ADC5A',
        navGlow: '0 0 20px rgba(90, 220, 90, 1)', // Define your glow here
        highlightDark: '#9E3C3C',
        highlightLight: '#FF0000',
      },
  
      blue: {
        default: '#2B4459',
        active: '#70B6EF',
        navGlow: '0 0 20px rgba(112, 182, 239, 1)', // Define your glow here
        highlightDark: '#9E3C3C',
        highlightLight: '#FF0000',
      },
  
      red: {
        default: '#492020',
        active: '#CC3636',
        navGlow: '0 0 20px rgba(204, 54, 54, 1)', // Define your glow here
        highlightDark: '#9E3C3C',
        highlightLight: '#FF0000',
      },
  
      white: {
        default: '#404040',
        active: '#DBDBDB',
        navGlow: '0 0 20px rgba(219, 219, 219, 1)', // Define your glow here
        highlightDark: '#9E3C3C',
        highlightLight: '#FF0000',
      },
    },

  },

  fontWeights: {
    light: 300,
    regular: 400,
    semiBold: 600,
    bold: 700,
  },

  typography: {
    display4: {
      fontFamily: "'League Spartan', sans-serif",
      fontWeight: 700,
      fontSize: '64pt',
    },
    display3: {
      fontFamily: "'League Spartan', sans-serif",
      fontWeight: 700,
      fontSize: '32pt',
    },
    display2: {
      fontFamily: "'League Spartan', sans-serif",
      fontWeight: 700,
      fontSize: '20pt',
    },
    display1: {
      fontFamily: "'League Spartan', sans-serif",
      fontWeight: 400,
      fontSize: '17pt',
    },
    title: {
      fontFamily: "'Inter 18pt', sans-serif",
      fontWeight: 600,
      fontSize: '17pt',
    },
    subtitle: {
      fontFamily: "'Inter 18pt', sans-serif",
      fontWeight: 600,
      fontSize: '14pt',
    },
    body2: {
      fontFamily: "'League Spartan', sans-serif",
      fontWeight: 700,
      fontSize: '13pt',
    },
    body1: {
      fontFamily: "'League Spartan', sans-serif",
      fontWeight: 400,
      fontSize: '12pt',
    },
    caption2: {
      fontFamily: "'League Spartan', sans-serif",
      fontWeight: 400,
      fontSize: '12pt',
    },
    caption1: {
      fontFamily: "'League Spartan', sans-serif",
      fontWeight: 400,
      fontSize: '8pt',
    },
    button: {
      fontFamily: "'League Spartan', sans-serif",
      fontWeight: 400,
      fontSize: '12pt',
    },
  },
};
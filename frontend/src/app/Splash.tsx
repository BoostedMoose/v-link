import { useEffect, useState } from 'react';
import styled, { css, keyframes } from 'styled-components';
import { APP } from '@/store/Store';

// Keyframes for fade-out animation
const fadeOut = keyframes`
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
`;

interface ContainerProps {
  fadeOutAnimation: boolean;
  fadeDuration: number;
}

// Styled-components
const Container = styled.div.withConfig({
  shouldForwardProp: (prop) => !['fadeOutAnimation', 'fadeDuration'].includes(prop)
})<ContainerProps>`
  position: absolute;
  z-index: 5;
  top: 0;
  left: 0;

  height: 100%;
  width: 100%;

  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 5px;
  overflow: hidden;
  background-color: black;

  /* Conditionally apply the fade-out animation */
  ${({ fadeOutAnimation, fadeDuration }) =>
    fadeOutAnimation &&
    css`
      animation: ${fadeOut} ${fadeDuration}ms ease-in-out forwards;
    `}

  transition: none;
  transform-origin: top;
`;

const Splash = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;

  justify-content: center;
  align-items: center;

  text-align: center;
  color: #DBDBDB;
  transform-origin: top;

  svg {
    margin-bottom: 1rem;
  }

  p {
    margin: 0;
  }
`;

const SplashScreen = () => {
  
  const [showLogo, setShowLogo] = useState(true); // Triggers fade-out animation
  const [showSplash, setShowSplash] = useState(true); // Determines if the splash screen is displayed
  const [fadeOutAnimation, setFadeOutAnimation] = useState(false); // Triggers fade-out animation
  const systemVersion = APP((state) => state.system.version);

  const displayTime = 2000; // Time before fade-out starts (in ms)
  const logoTime = 1750; // Time before fade-out starts (in ms)
  const fadeDuration = 1250; // Duration of the fade-out animation (in ms)

  useEffect(() => {
    // Start the fade-out animation after the display time
    const fadeOutTimeout = setTimeout(() => {
      setFadeOutAnimation(true);
    }, displayTime);

    const logoTimeOut = setTimeout(() => {
      setShowLogo(false);
    }, logoTime);

    // Remove the splash screen after the fade-out animation ends
    const hideSplashTimeout = setTimeout(() => {
      setShowSplash(false);
    }, displayTime + fadeDuration); // display time + fade duration

    // Cleanup timeouts on unmount
    return () => {
      clearTimeout(fadeOutTimeout);
      clearTimeout(hideSplashTimeout);
    };
  }, []);

  return (
    showSplash && (
      <Container fadeOutAnimation={fadeOutAnimation} fadeDuration={fadeDuration}>

        {showLogo &&
          <Splash>
            <svg xmlns="http://www.w3.org/2000/svg" width="20vh" height="20vh" style={{ fill: 'white' }}>
              <use xlinkHref="/assets/svg/logos/moose.svg#moose"></use>
            </svg>
            <svg xmlns="http://www.w3.org/2000/svg" width="40vh" height="10vh" style={{ fill: 'white' }}>
              <use xlinkHref="/assets/svg/logos/vlink.svg#vlink"></use>
            </svg>
            <p> { systemVersion }</p>
          </Splash>
        }

      </Container>
    )
  );
};

export default SplashScreen;

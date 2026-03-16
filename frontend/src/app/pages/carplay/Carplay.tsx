import React, { useState, useEffect, useCallback } from 'react';
import styled, { css, keyframes, useTheme } from 'styled-components';
import { eventEmitter } from '@/app/helper/EventEmitter';
import { APP, useThemeColor } from '@/store/Store';
import { Typography } from '@/theme/styles/Typography';
import { Link } from '@/theme/styles/Inputs';
import { CustomIcon } from '@/theme/styles/Icons';
import { useNamespaces } from '@/socket/Namespaces';

// Keyframes for opening and closing the chainlink
const openChainLeft = keyframes`
  0% { transform: rotate(0deg) translateY(0px); }
  100% { transform: rotate(-20deg) translateY(7px)  translateX(-3px); }
`;

const openChainRight = keyframes`
  0% { transform: rotate(0deg) translateY(0px); }
  100% { transform: rotate(-20deg) translateY(-7px)  translateX(3px); }
`;

const closeChainLeft = keyframes`
  0% { transform: rotate(-20deg) translateY(7px)  translateX(-3px); }
  100% { transform: rotate(0deg) translateY(0px); }
`;

const closeChainRight = keyframes`
  0% { transform: rotate(-20deg) translateY(-7px)  translateX(3px); }
  100% { transform: rotate(0deg) translateY(0px); }
`;


interface SvgContainerProps {
  connected?: boolean;
}

// Styled SVG container for animation
const SvgContainer = styled.svg<SvgContainerProps>`
  width: 100px;
  height: auto;

  path.left {
    animation: ${({ connected }) =>
        connected
            ? css`${closeChainLeft} 0.15s ease-in-out forwards`
            : css`${openChainLeft} 0.3s ease-in-out 2s forwards`};
    transform-origin: center left; /* Adjust pivot for proper rotation */
  }

  path.right {
    animation: ${({ connected }) =>
        connected
            ? css`${closeChainRight} 0.15s ease-in-out forwards`
            : css`${openChainRight} 0.3s ease-in-out 2s forwards`};
    transform-origin: center right; /* Adjust pivot for proper rotation */
  }
`;

// Container styling
const Container = styled.div`
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  overflow: hidden;
  z-index: 3;
`;

function Carplay() {
    const theme = useTheme();
    const socket = useNamespaces();
    
    const themeColor = useThemeColor();
    const carplaySettings = APP((state) => state.system.carplay);
    const appUpdate       = APP((state) => state.update);
    
    const Body2 = Typography.Body2;

    const [isActive, setIsActive] = useState(false);

    // Check for connected USB devices with retry logic
    const checkDevice = useCallback(async () => {
        let attempts = 0;
        const maxAttempts = 15;
        const interval = 1000; // 1 second

        const retryCheck = async () => {
            try {
                const devices = await navigator.usb.getDevices();

                if (devices.length > 0) {
                    console.log(`(CarPlay) Devices found: ${devices}`);
                    socket.log.emit('info', `(CarPlay) Devices found: ${devices}`);
                    appUpdate((state) => {
                        state.system.carplay.paired = true;
                    });
                    return true;
                } else {
                    if(attempts < 1) {
                        console.log('(CarPlay) No devices connected or authorized. Retrying...');
                        socket.log.emit('info', `(CarPlay) No devices connected or authorized. Retrying...`);
                    }

                    if (++attempts < maxAttempts) {
                        setTimeout(retryCheck, interval);
                    } else {
                        console.log('(CarPlay) Max attempts reached. No devices found');
                        socket.log.emit('info', `(CarPlay) Max attempts reached. No devices found`);
                    }

                    return false;
                }
            } catch (error) {
                console.error('(CarPlay) Error checking devices:', error);
                socket.log.emit('info', `(CarPlay) Error checking devices: ${error}`);

                if (++attempts < maxAttempts) {
                    setTimeout(retryCheck, interval);
                } else {
                    console.log('(CarPlay) Max attempts reached. Stopping retry');
                    socket.log.emit('info', `(CarPlay) Max attempts reached. Stopping retry`);
                }
                return false;
            }
        };

        retryCheck();
    }, []);

    // Check devices on component load
    useEffect(() => {
        checkDevice();
    }, [checkDevice]);

    // Handle button click
    const onClick = () => {
        if (!carplaySettings.paired) {
            // Send event to carplay component to pair the dongle
            console.log('(CarPlay) Pairing Dongle');
            socket.log.emit('info', `(CarPlay) Pairing Dongle`);

            eventEmitter.dispatchEvent(new Event('pairDongle'));
            checkDevice();
            setIsActive(!isActive);
        } else {
            appUpdate((state) => {
                // Trigger user activation
                state.system.carplay.user = true;
            });
        }
    };

    return (
        <Container>
            <Body2>
                {carplaySettings.paired && carplaySettings.dongle
                    ? carplaySettings.connected && carplaySettings.worker
                        ? 'LAUNCHING...'
                        : 'CONNECT iPHONE / ANDROID DEVICE'
                    : 'CLICK TO PAIR DONGLE'}
            </Body2>
            <Link
                onClick={() => onClick()}
                isActive={isActive}
                style={{
                    width: '150px',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                <CustomIcon
                    size={60}
                    isActive={isActive}
                    theme={theme}
                    stroke={4}
                    fill={
                        carplaySettings.paired && carplaySettings.dongle
                            ? carplaySettings.phone
                                ? carplaySettings.worker
                                    ? theme.colors.theme[themeColor].active
                                    : theme.colors.theme[themeColor].default
                                : theme.colors.medium
                            : theme.colors.medium
                    }
                    color={
                        carplaySettings.paired && carplaySettings.dongle
                            ? carplaySettings.phone
                                ? carplaySettings.worker
                                    ? theme.colors.theme[themeColor].active
                                    : theme.colors.theme[themeColor].default
                                : theme.colors.medium
                            : theme.colors.medium
                    }
                    glowColor={theme.colors.theme[themeColor].default}
                >
                    <SvgContainer
                        connected={
                            carplaySettings.paired &&
                            carplaySettings.dongle &&
                            carplaySettings.worker
                        }
                        xmlns='http://www.w3.org/2000/svg'
                        viewBox='-10 -10 61 36.5'
                    >
                        <defs>
                            {carplaySettings.worker && (
                                <filter id='glow' x='-50%' y='-50%' width='400%' height='400%'>
                                    {/* Add a blur effect */}
                                    <feGaussianBlur stdDeviation='2' result='blurredGlow' />
                                    {/* Merge the original and the blurred path */}
                                    <feMerge>
                                        <feMergeNode in='blurredGlow' />
                                        <feMergeNode in='SourceGraphic' />
                                    </feMerge>
                                </filter>
                            )}
                        </defs>
                        <g className='cls-1' filter={carplaySettings.worker ? 'url(#glow)' : undefined}>
                            <path
                                className='left'
                                d='M13,14.5h-5c-4,0-6-3.5-6-6s2-6.5,6-6.5h10c4,0,6,3.5,6,6.5'
                            />
                            <path
                                className='right'
                                d='M28,2h5c4,0,6,3.5,6,6s-2,6.5-6,6.5h-10c-4,0-6-3.5-6-6.5'
                            />
                        </g>
                    </SvgContainer>
                </CustomIcon>
            </Link>
        </Container>
    );    
}

export default Carplay;

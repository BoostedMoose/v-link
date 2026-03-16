import { useEffect, useState } from 'react';
import styled, { keyframes, css } from 'styled-components';
import { Typography } from '@/theme/styles/Typography';
import { Button } from '@/theme/styles/Inputs';
import { APP } from '@/store/Store';

import { useNamespaces } from '@/socket/Namespaces';
const socket = useNamespaces();
//socket.log.emit('error', 'Could not load profile. Exiting.')

const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

const Container = styled.div`
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    width: 100%;
    gap: 15px;
    box-sizing: border-box;
    padding-left: 50px;
    padding-right: 50px;
    padding-top: 30px;
    padding-bottom: 20px;
    background: ${({ theme }) => theme.colors.gradients.gradient1};
    overscroll: hidden;
`;

const Box = styled.div`
  margin: 10px;
  width: 100%;
  height: 100%;
  padding: 30px;
  position: relative;  
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  background: ${({ theme }) => theme.colors.gradients.gradient2};
  overflow: hidden;

  animation: ${fadeIn} 0.6s ease;
`;

const Options = styled.div`
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 100px;
    margin-bottom: 5%;
    position: relative;
    transition: all 0.6s cubic-bezier(0.4, 0, 0.2, 1);
`;

interface OptionItemProps {
  platform: string | null;
  hasSelection: boolean;
  isSelected: boolean;
  animationPhase: string | null;
  index: number;
  totalItems: number;
  isTransitioning: boolean;
}

interface SVGContainerProps {
  platform: string | null;
  isSelected: boolean;
}

const OptionItem = styled.div<OptionItemProps>`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
    height: 125px;
    
    transition: all 0.6s cubic-bezier(0.4, 0, 0.2, 1);
    opacity: ${props => {
        if (props.platform) return 1;
        if (!props.hasSelection) return 1;
        if (props.isSelected) return 1;
        return (props.animationPhase === 'fade' || props.animationPhase === 'slide') ? 0 : 1;
    }};
    transform: ${props => {
        if (props.platform || !props.hasSelection) return 'translateX(0)';
        if (props.isSelected && props.animationPhase === 'slide') {
            // Calculate offset to move selected item to center
            const gap = 100;
            const currentOffset = (props.index - (props.totalItems - 1) / 2) * (100 + gap);
            return `translateX(${-currentOffset}px)`;
        }
        return 'translateX(0)';
    }};
    visibility: ${props => {
        if (props.platform) return 'visible';
        if (!props.hasSelection) return 'visible';
        if (props.isSelected) return 'visible';
        return props.animationPhase === 'slide' ? 'hidden' : 'visible';
    }};

    animation: ${props => {
        // Don't animate fadeIn during transitions or for selected items that are sliding
        if (props.isTransitioning || (props.isSelected && props.animationPhase === 'slide')) {
            return css`none`;
        }
        return css`${fadeIn} 0.6s ease`;
    }};
`;

const SVGContainer = styled.div<SVGContainerProps>`
    transition: ${props => props.platform ? 'none' : 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)'};
    transform: ${props => props.platform ? 'scale(1)' : (props.isSelected ? 'scale(1.2)' : 'scale(1)')};
    cursor: ${props => props.platform ? 'default' : 'pointer'};

    &:hover {
        transform: ${props => props.platform ? 'scale(1)' : (props.isSelected ? 'scale(1.25)' : 'scale(1.1)')};
    }
`;

const Init = () => {
    const Body1 = Typography.Body1;
    const Title = Typography.Title;
    const Caption2 = Typography.Caption2;

    const [profiles, setProfiles] = useState<Record<string, string[]>>({});
    const [options, setOptions] = useState<string[]>([]);
    const [platform, setPlatform] = useState<string | null>(null);
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
    const [animationPhase, setAnimationPhase] = useState<string | null>(null); // 'fade' or 'slide'
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [visible, setVisible] = useState(true);

    const appUpdate = APP((state) => state.update);

    const startApp = (custom_config?: boolean) => {
        if (custom_config)
            socket.log.emit('info', 'Config-files found, loading settings.');
        else
            socket.log.emit('info', 'Default profile selected, loading settings.');

        socket.sys.emit('systemTask', 'start');
        setVisible(false)
        
        appUpdate((state) => {
            state.system.configLoaded = true;
        });
    }


    useEffect(() => {
        // Checks whether .config/v-link/ exists
        // Returns either true or an object with selectable profiles.
        socket.log.emit('info', `Checking for existing config files...`);
        socket.sys.emit('systemTask', 'check', (data: Record<string, string[]> | true) => {
            if (data === true) {
                startApp();
            } else {
                setProfiles(data);
                setOptions(Object.keys(data));
            }
        });
    }, []);

    const handleSelectPlatform = (profile: string, index: number) => {
        setSelectedIndex(index);
        setAnimationPhase('fade');
        setIsTransitioning(true);

        // First fade out non-selected items (300ms)
        setTimeout(() => {
            setAnimationPhase('slide');
        }, 300);

        // Then slide selected item to center and update state (600ms total)
        setTimeout(() => {
            setPlatform(profile);
            setOptions(profiles[profile]);
            setSelectedIndex(null);
            setAnimationPhase(null);
            // Keep isTransitioning true for a bit longer to prevent fadeIn on new render
            setTimeout(() => setIsTransitioning(false), 100);
        }, 600);
    };

    const handleSelectEngine = (engine: string, index: number) => {
        setSelectedIndex(index);
        socket.log.emit('info', `Selected profile: ${engine}`);

        const vehicle = {
            platform: platform,
            engine: engine,
        };


        socket.sys.emit('systemTask', 'load', vehicle, (data: boolean) => {
            if (data) {
                startApp(true);
            } else {
                socket.log.emit('error', 'Could not load profile. Exiting.')
                socket.sys.emit('systemTask', 'quit')
            }
        });


    };

    return (
        visible ?
            <Container>
                <Box>
                    <div style={{ display: 'flex', flexShrink: 1, flexDirection: 'column', alignItems: 'center' }}>
                        <Title>
                            {platform ? 'Please select the engine type:' : 'Please select your vehicle platform:'}
                        </Title>
                    </div>
                    <Options>
                        {options.map((item, index) => (
                            <OptionItem
                                key={item}
                                index={index}
                                isSelected={selectedIndex === index}
                                hasSelection={selectedIndex !== null}
                                platform={platform}
                                totalItems={options.length}
                                animationPhase={animationPhase}
                                isTransitioning={isTransitioning}
                            >
                                <SVGContainer
                                    isSelected={selectedIndex === index}
                                    platform={platform}
                                >
                                    <svg
                                        width='100'
                                        height='100'
                                        fill='white'
                                        onClick={() =>
                                            platform
                                                ? null
                                                : handleSelectPlatform(item, index)
                                        }
                                    >
                                        <use
                                            xlinkHref={`/assets/svg/vehicles/${platform ? platform : item}.svg#${platform ? platform : item}`}
                                        />
                                    </svg>
                                </SVGContainer>
                                <Button
                                    style={{ backgroundColor: platform ? undefined : 'transparent' }}
                                    onClick={() =>
                                        platform
                                            ? handleSelectEngine(item, index)
                                            : handleSelectPlatform(item, index)
                                    }
                                >
                                    <Caption2>{item}</Caption2>
                                </Button>
                            </OptionItem>
                        ))}
                    </Options>
                    <Options>
                        {platform && (
                            <Button
                                style={{ width: '25%' }}
                                onClick={() => {
                                    setPlatform(null);
                                    setOptions(Object.keys(profiles));
                                    setSelectedIndex(null);
                                }}
                            >
                                <Caption2>BACK</Caption2>
                            </Button>
                        )}
                        {!platform && (
                            <Button
                                style={{ width: '25%' }}
                                onClick={() =>
                                    socket.sys.emit('systemTask', 'load', "default", (data: boolean) => {
                                        if (data) {
                                            startApp(false);
                                        }
                                    })
                                }
                            >
                                <Caption2>SKIP</Caption2>
                            </Button>
                        )}
                        <Button
                            style={{ width: '25%' }}
                            onClick={() =>
                                socket.sys.emit('systemTask', 'quit')
                            }
                        >
                            <Caption2>EXIT</Caption2>
                        </Button>
                    </Options>
                </Box>
            </Container> : <></>
    );
};

export default Init;
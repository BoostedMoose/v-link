import { useState, useEffect, } from "react";
import styled, { css, useTheme } from 'styled-components';

import { APP, useThemeColor } from '@/store/Store';

import { Typography } from '@/theme/styles/Typography';
import { Link, Button } from '@/theme/styles/Inputs';
import { IconMedium } from '@/theme/styles/Icons';

import { openModal, closeModal } from '@/app/components/Modal';

type SideBarsSettings = { sideBarWidth: { value: number } };

interface SidebarProps {
    currentView: string;
    minWidth: number;
    maxWidth: number;
    collapseLength: number;
}

interface SideBarProps {
    collapseLength: number;
}

const Sidebar = styled.div<SidebarProps>`

    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-self: flex-end;
    height: 100%;

    box-sizing: border-box;

    /* Apply the animation based on the current view */
    animation: ${({ theme, currentView, minWidth, maxWidth, collapseLength }) => css`
    ${currentView === 'Settings'
            ? theme.animations.getHorizontalExpand(minWidth, maxWidth)
            : theme.animations.getHorizontalCollapse(minWidth, maxWidth)} ${collapseLength}s ease-in-out forwards;
    `};

  /* Avoid transition conflicts */
  transition: none;
  overflow: hidden;
`;

const Menu = styled.div`
    width: 100%;
    height: 100%;


    display: flex;
    flex-direction: column;
    align-self: center;
    justify-self: flex-start;
    justify-content: flex-start;
    align-items: flex-start;
`;


const SideBar = ({ collapseLength }: SideBarProps) => {

    const view = APP((state) => state.system.view)
    const settingPage = APP((state) => state.system.settingPage)
    const appUpdate = APP((state) => state.update)
    const versionNumber = APP((state) => state.system.version)
    const sideBarWidth = APP((state) => (state.settings.side_bars as SideBarsSettings | undefined)?.sideBarWidth?.value ?? 0);
    const canEnabled = APP((state) => (state.settings as any)?.constants?.modules?.can);
    const themeColor = useThemeColor();

    const theme = useTheme();

    const Caption2 = Typography.Caption2;
    const Caption1 = Typography.Caption1;
    const Title = Typography.Title;

    const [moose, setMoose] = useState(false);
    const [currentTab, setCurrentTab] = useState(settingPage)

    /* Switch Tabs */
    const handleTabChange = (tabId: string) => {
        appUpdate((state) => {
            state.system.settingPage = tabId;
        });
    };

    useEffect(() => {
        setCurrentTab(settingPage)
    }, [settingPage])

    useEffect(() => {
        if (view !== 'Settings') {
            appUpdate((state) => {
                state.system.settingPage = 'general';
            });
        }
    }, [view]);

    return (
        <Sidebar
            currentView={view}
            collapseLength={collapseLength / 1000}
            minWidth={0}
            maxWidth={sideBarWidth}>

            <Menu>
                <Link>
                    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', alignItems: 'flex-start' }}>
                        <Title style={{ color: theme.colors.medium }}>SETTINGS</Title>
                    </div>
                </Link>
                <Link
                    onClick={() => handleTabChange('general')}
                    isActive={currentTab === 'general'}
                    activeColor={theme.colors.light}
                    inactiveColor={theme.colors.medium}>
                    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', alignItems: 'left' }}>
                        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px', width: '100%' }}>
                            <IconMedium
                                isActive={currentTab === 'general'}
                                activeColor={theme.colors.theme[themeColor].active}
                                defaultColor={theme.colors.theme[themeColor].default}
                                inactiveColor={theme.colors.medium}>
                                <use xlinkHref={`/assets/svg/buttons/general.svg#general`}></use>
                            </IconMedium>
                            General
                        </div>
                    </div>
                </Link>
                <Link
                    onClick={() => handleTabChange('display')}
                    isActive={currentTab === 'display'}
                    activeColor={theme.colors.light}
                    inactiveColor={theme.colors.medium}>
                    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', alignItems: 'left' }}>
                        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px', width: '100%' }}>
                            <IconMedium
                                isActive={currentTab === 'display'}
                                activeColor={theme.colors.theme[themeColor].active}
                                defaultColor={theme.colors.theme[themeColor].default}
                                inactiveColor={theme.colors.medium}>
                                <use xlinkHref={`/assets/svg/buttons/display.svg#display`}></use>
                            </IconMedium>
                            Display
                        </div>
                    </div>
                </Link>
                <Link
                    onClick={() => handleTabChange('audio')}
                    isActive={currentTab === 'audio'}
                    activeColor={theme.colors.light}
                    inactiveColor={theme.colors.medium}>
                    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', alignItems: 'left' }}>
                        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px', width: '100%' }}>
                            <IconMedium
                                isActive={currentTab === 'audio'}
                                activeColor={theme.colors.theme[themeColor].active}
                                defaultColor={theme.colors.theme[themeColor].default}
                                inactiveColor={theme.colors.medium}>
                                <use xlinkHref={`/assets/svg/buttons/music.svg#music`}></use>
                            </IconMedium>
                            Audio
                        </div>
                    </div>
                </Link>
                <Link
                    onClick={() => handleTabChange('rearcam')}
                    isActive={currentTab === 'rearcam'}
                    activeColor={theme.colors.light}
                    inactiveColor={theme.colors.medium}>
                    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', alignItems: 'left' }}>
                        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px', width: '100%' }}>
                            <IconMedium
                                isActive={currentTab === 'rearcam'}
                                activeColor={theme.colors.theme[themeColor].active}
                                defaultColor={theme.colors.theme[themeColor].default}
                                inactiveColor={theme.colors.medium}>
                                <use xlinkHref={`/assets/svg/buttons/rearcam.svg#rearcam`}></use>
                            </IconMedium>
                            Camera
                        </div>
                    </div>
                </Link>
                {canEnabled &&
                    <Link
                        onClick={() => handleTabChange('interface')}
                        isActive={currentTab === 'interface'}
                        activeColor={theme.colors.light}
                        inactiveColor={theme.colors.medium}>
                        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', alignItems: 'left' }}>
                            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px', width: '100%' }}>
                                <IconMedium
                                    isActive={currentTab === 'interface'}
                                    activeColor={theme.colors.theme[themeColor].active}
                                    defaultColor={theme.colors.theme[themeColor].default}
                                    inactiveColor={theme.colors.medium}>
                                    <use xlinkHref={`/assets/svg/buttons/link.svg#link`}></use>
                                </IconMedium>
                                Interface
                            </div>
                        </div>
                    </Link>
                }
                <Link
                    onClick={() => handleTabChange('dashboard')}
                    isActive={currentTab === 'dashboard'}
                    activeColor={theme.colors.light}
                    inactiveColor={theme.colors.medium}>
                    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', alignItems: 'left' }}>
                        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px', width: '100%' }}>
                            <IconMedium
                                isActive={currentTab === 'dashboard'}
                                activeColor={theme.colors.theme[themeColor].active}
                                defaultColor={theme.colors.theme[themeColor].default}
                                inactiveColor={theme.colors.medium}>
                                <use xlinkHref={`/assets/svg/buttons/interface.svg#interface`}></use>
                            </IconMedium>
                            Dashboard
                        </div>
                    </div>
                </Link>

                <Link
                    onClick={() => handleTabChange('keymap')}
                    isActive={currentTab === 'keymap'}
                    activeColor={theme.colors.light}
                    inactiveColor={theme.colors.medium}>
                    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', alignItems: 'left' }}>
                        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px', width: '100%' }}>
                            <IconMedium
                                isActive={currentTab === 'keymap'}
                                activeColor={theme.colors.theme[themeColor].active}
                                defaultColor={theme.colors.theme[themeColor].default}
                                inactiveColor={theme.colors.medium}>
                                <use xlinkHref={`/assets/svg/buttons/keymap.svg#keymap`}></use>
                            </IconMedium>
                            Keymap
                        </div>
                    </div>
                </Link>

                <Link
                    onClick={() => handleTabChange('dongle')}
                    isActive={currentTab === 'dongle'}
                    activeColor={theme.colors.light}
                    inactiveColor={theme.colors.medium}>
                    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', alignItems: 'left' }}>
                        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px', width: '100%' }}>
                            <IconMedium
                                isActive={currentTab === 'dongle'}
                                activeColor={theme.colors.theme[themeColor].active}
                                defaultColor={theme.colors.theme[themeColor].default}
                                inactiveColor={theme.colors.medium}>
                                <use xlinkHref={`/assets/svg/buttons/carplay.svg#carplay`}></use>
                            </IconMedium>
                            Dongle
                        </div>
                    </div>
                </Link>

                <Link
                    onClick={() => handleTabChange('system')}
                    isActive={currentTab === 'system'}
                    activeColor={theme.colors.light}
                    inactiveColor={theme.colors.medium}>
                    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', alignItems: 'left' }}>
                        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px', width: '100%' }}>
                            <IconMedium
                                isActive={currentTab === 'system'}
                                activeColor={theme.colors.theme[themeColor].active}
                                defaultColor={theme.colors.theme[themeColor].default}
                                inactiveColor={theme.colors.medium}>
                                <use xlinkHref={`/assets/svg/buttons/system.svg#system`}></use>
                            </IconMedium>
                            System
                        </div>
                    </div>
                </Link>

                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'left', height: `${theme.interaction.buttonHeight}px` }}>
                    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '5px' }}>
                        <Link onClick={() => {
                            openModal("You found the Hidden Moose", "Its antlers will guide you safely through the journey!", "Boost the Moose", closeModal)
                            setMoose(true)
                        }}>

                            <IconMedium style={{ fill: 'none', stroke: moose ? theme.colors.theme[themeColor].active : 'none' }} onClick={() => setMoose(!moose)}>
                                <use xlinkHref={`/assets/svg/logos/moose.svg#moose`}></use>
                            </IconMedium>

                        </Link>
                        <Caption1 style={{ color: theme.colors.medium }}> {versionNumber}</Caption1>
                    </div>
                </div>

            </Menu>
        </Sidebar>
    );
};


export default SideBar;

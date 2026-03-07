import { useState, useEffect, } from "react";
import styled, { css, useTheme } from 'styled-components';

import { APP } from '../../store/Store';

import { Typography } from '../../theme/styles/Typography';
import { Link, Button } from '../../theme/styles/Inputs';
import { IconMedium } from '../../theme/styles/Icons';

import {openModal, closeModal} from '../components/Modal';



const Sidebar = styled.div`

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


const SideBar = ({ collapseLength }) => {
    

    const view          = APP((state) => state.system.view)
    const settingPage   = APP((state) => state.system.settingPage)
    const appUpdate     = APP((state) => state.update)
    const versionNumber = APP((state) => state.system.version)
    const sideBarWidth  = APP((state) => state.settings.side_bars.sideBarWidth.value)
    const themeColor    = APP((state) => state.settings.general.colorTheme.value).toLowerCase();

    const theme = useTheme();

    const Caption2 = Typography.Caption2;
    const Caption1 = Typography.Caption1;
    const Title = Typography.Title;

    const [moose, setMoose] = useState(false);
    const [currentPage, setCurrentPage] = useState(view)
    const [currentTab, setCurrentTab] = useState(settingPage)

    /* Switch Tabs */
    const handleTabChange = (tabIndex) => {
        appUpdate((state) => {
            state.system.settingPage = tabIndex;
        });
    };

    useEffect(() => {
        setCurrentTab(settingPage)
    }, [settingPage])

    
    return (
        <Sidebar
            theme={theme}
            currentPage={currentPage}
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
                    onClick={() => handleTabChange(1)}
                    isActive={currentTab === 1}
                    activeColor={theme.colors.light}
                    inactiveColor={theme.colors.medium}>
                    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', alignItems: 'left' }}>
                        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px', width: '100%' }}>
                            <IconMedium
                                isActive={currentTab === 1}
                                theme={theme}
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
                    onClick={() => handleTabChange(6)}
                    isActive={currentTab === 6}
                    activeColor={theme.colors.light}
                    inactiveColor={theme.colors.medium}>
                    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', alignItems: 'left' }}>
                        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px', width: '100%' }}>
                            <IconMedium
                                isActive={currentTab === 6}
                                theme={theme}
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
                    onClick={() => handleTabChange(7)}
                    isActive={currentTab === 7}
                    activeColor={theme.colors.light}
                    inactiveColor={theme.colors.medium}>
                    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', alignItems: 'left' }}>
                        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px', width: '100%' }}>
                            <IconMedium
                                isActive={currentTab === 7}
                                theme={theme}
                                activeColor={theme.colors.theme[themeColor].active}
                                defaultColor={theme.colors.theme[themeColor].default}
                                inactiveColor={theme.colors.medium}>
                                <use xlinkHref={`/assets/svg/buttons/rearcam.svg#rearcam`}></use>
                            </IconMedium>
                            Rear Camera
                        </div>
                    </div>
                </Link>
                <Link
                    onClick={() => handleTabChange(8)}
                    isActive={currentTab === 8}
                    activeColor={theme.colors.light}
                    inactiveColor={theme.colors.medium}>
                    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', alignItems: 'left' }}>
                        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px', width: '100%' }}>
                            <IconMedium
                                isActive={currentTab === 8}
                                theme={theme}
                                activeColor={theme.colors.theme[themeColor].active}
                                defaultColor={theme.colors.theme[themeColor].default}
                                inactiveColor={theme.colors.medium}>
                                <use xlinkHref={`/assets/svg/buttons/system.svg#system`}></use>
                            </IconMedium>
                            Diagnostics
                        </div>
                    </div>
                </Link>
                <Link
                    onClick={() => handleTabChange(2)}
                    isActive={currentTab === 2}
                    activeColor={theme.colors.light}
                    inactiveColor={theme.colors.medium}>
                    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', alignItems: 'left' }}>
                        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px', width: '100%' }}>
                            <IconMedium
                                isActive={currentTab === 2}
                                theme={theme}
                                activeColor={theme.colors.theme[themeColor].active}
                                defaultColor={theme.colors.theme[themeColor].default}
                                inactiveColor={theme.colors.medium}>
                                <use xlinkHref={`/assets/svg/buttons/interface.svg#interface`}></use>
                            </IconMedium>
                            Interface
                        </div>
                    </div>
                </Link>

                <Link
                    onClick={() => handleTabChange(3)}
                    isActive={currentTab === 3}
                    activeColor={theme.colors.light}
                    inactiveColor={theme.colors.medium}>
                    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', alignItems: 'left' }}>
                        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px', width: '100%' }}>
                            <IconMedium
                                isActive={currentTab === 3}
                                theme={theme}
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
                    onClick={() => handleTabChange(4)}
                    isActive={currentTab === 4}
                    activeColor={theme.colors.light}
                    inactiveColor={theme.colors.medium}>
                    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', alignItems: 'left' }}>
                        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px', width: '100%' }}>
                            <IconMedium
                                isActive={currentTab === 4}
                                theme={theme}
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
                    onClick={() => handleTabChange(5)}
                    isActive={currentTab === 5}
                    activeColor={theme.colors.light}
                    inactiveColor={theme.colors.medium}>
                    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', alignItems: 'left' }}>
                        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px', width: '100%' }}>
                            <IconMedium
                                isActive={currentTab === 5}
                                theme={theme}
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

                            <IconMedium theme={theme} style={{ fill: 'none', stroke: moose ? theme.colors.theme[themeColor].active : 'none' }} onClick={() => setMoose(!moose)}>
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

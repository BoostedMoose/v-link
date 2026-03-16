import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import styled, { useTheme } from 'styled-components';

import { DATA, APP, ModuleState, useThemeColor, ThemeColorKey } from '@/store/Store';
import { CustomIcon } from '@/theme/styles/Icons';

type SettingValue<T> = { value: T };
type SensorSetting = { value: string; type: string };
type DashClassicSettings = {
    value_1: SensorSetting;
    value_2: SensorSetting;
    message_data: SensorSetting;
    message_threshold: SettingValue<number>;
    message_text: SettingValue<string>;
    message_option: SettingValue<string>;
};
type SensorConfig = { app_id?: string | null; limit_start?: number };

const Container = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;

  box-sizing: border-box;
  padding-top: 30px;

  background-image: url('/assets/svg/background/road.svg#road');
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
`;

const Databox = styled.div`
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 100%;
`;
const Icons = styled.div`
  flex 1;
  display: flex;
  gap: 200px;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 20px;
  padding-left: 20px;
  padding-right: 20px;
  box-sizing: border-box;
`;

const Svg = styled.svg`
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 100%;
`;

const DataBox = () => {
    const theme = useTheme();
    const data = DATA((state) => state.data);
    const modules = APP((state) => state.modules);

    const dash_classic = APP((state) => state.settings.dash_classic as DashClassicSettings | undefined);
    const themeColor = useThemeColor();

    // Extract settings (null-safe — settings may not be loaded yet)
    const leftName = dash_classic?.value_1.value ?? '';
    const leftType = dash_classic?.value_1.type;
    const rightName = dash_classic?.value_2.value ?? '';
    const rightType = dash_classic?.value_2.type;
    const centerName = dash_classic?.message_data.value ?? '';
    const centerType = dash_classic?.message_data.type;

    const padding = 20;
    const containerRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const { width, height } = dimensions;

    const getSensorConfig = (
        moduleMap: Record<string, unknown>,
        type: string | undefined,
        name: string | undefined,
    ): SensorConfig => {
        if (!type) return {}; // empty type → return empty object
        const selector = moduleMap[type] as
            | ((select: (s: ModuleState) => unknown) => unknown)
            | undefined;
        if (!selector) return {};
        const sensor = selector((state: ModuleState) =>
            (state.settings.sensors as Record<string, unknown> | undefined)?.[name ?? '']
        );
        return sensor && typeof sensor === 'object' ? (sensor as SensorConfig) : {};
    };

    const leftSensorConfig = getSensorConfig(modules, leftType, leftName);
    const rightSensorConfig = getSensorConfig(modules, rightType, rightName);
    const centerSensorConfig = getSensorConfig(modules, centerType, centerName);

    // Memoize dashboard data
    const dashData = useMemo(() => {
        return {
            left: {
                name: leftName,
                data: data[leftName] ?? 'N/A',
                id: leftSensorConfig.app_id ?? null,
                limit: leftSensorConfig.limit_start ?? Infinity,
            },
            right: {
                name: rightName,
                data: data[rightName] ?? 'N/A',
                id: rightSensorConfig.app_id ?? null,
                limit: rightSensorConfig.limit_start ?? Infinity,
            },
            center: {
                name: centerName,
                data: data[centerName] ?? 'N/A',
                id: centerSensorConfig.app_id ?? null,
                limit: dash_classic?.message_threshold.value ?? Infinity,
                msg: dash_classic?.message_text.value ?? 'No Message',
                operator: dash_classic?.message_option.value ?? '=',
            },
        };
    }, [
        leftName,
        leftSensorConfig,
        rightName,
        rightSensorConfig,
        centerName,
        centerSensorConfig,
        data,
        dash_classic?.message_threshold.value,
        dash_classic?.message_text.value,
        dash_classic?.message_option.value,
    ]);

    const { customMsg, toggle } = useMemo(() => {
        const { data: centerData, limit, msg, operator } = dashData.center;
        const numericData = centerData as number;
        let message = 'No Messages';
        let active = false;

        if (operator === '>' && numericData > limit) {
            message = msg;
            active = true;
        } else if (operator === '<' && numericData < limit) {
            message = msg;
            active = true;
        } else if (operator === '=' && numericData === limit) {
            message = msg;
            active = true;
        }

        return { customMsg: message, toggle: active };
    }, [
        dashData.center.data,
        dashData.center.limit,
        dashData.center.msg,
        dashData.center.operator,
    ]);

    // Handle resize
    const handleResize = useCallback(() => {
        if (containerRef.current) {
            setDimensions({
                width: containerRef.current.offsetWidth,
                height: containerRef.current.offsetHeight,
            });
        }
    }, []);

    useEffect(() => {
        const resizeObserver = new ResizeObserver(handleResize);
        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
            handleResize();
        }
        return () => resizeObserver.disconnect();
    }, [handleResize]);

    // Theme colors
    const themeColors = useMemo(
        () => ({
            activeColor: theme.colors.theme[themeColor].highlightDark,
            defaultColor: theme.colors.light,
            inactiveColor: theme.colors.medium,
            glowColor: theme.colors.theme[themeColor].default,
            blueHighlight: theme.colors.theme.blue.highlightDark,
        }),
        [theme.colors, themeColor]
    );

    return (
        <Container>
            <Icons>
                <CustomIcon
                    stroke={2}
                    size={25}
                    isActive={(dashData.left.data as number) > dashData.left.limit}
                    activeColor={themeColors.activeColor}
                    defaultColor={themeColors.defaultColor}
                    inactiveColor={themeColors.inactiveColor}
                    glowColor={themeColors.glowColor}
                >
                    {dashData.left.id != null &&
                        <use
                            xlinkHref={`/assets/svg/icons/data/${dashData.left.id}.svg#${dashData.left.id}`}
                        />
                    }
                </CustomIcon>

                <CustomIcon
                    color={toggle ? themeColors.blueHighlight : themeColors.inactiveColor}
                    stroke={2}
                    size={40}
                >
                    <use xlinkHref={`/assets/svg/icons/data/${'err'}.svg#${'err'}`} />
                </CustomIcon>

                <CustomIcon
                    stroke={2}
                    size={25}
                    isActive={(dashData.right.data as number) > dashData.right.limit}
                    activeColor={themeColors.activeColor}
                    defaultColor={themeColors.defaultColor}
                    inactiveColor={themeColors.inactiveColor}
                    glowColor={themeColors.glowColor}
                >
                    {dashData.right.id != null &&
                        <use
                            xlinkHref={`/assets/svg/icons/data/${dashData.right.id}.svg#${dashData.right.id}`}
                        />
                    }
                </CustomIcon>
            </Icons>

            <Databox ref={containerRef}>
                {width > 0 && height > 0 && (
                    <Svg viewBox={`0 0 ${width} ${height}`}>
                        <defs>
                            <linearGradient id="fadeDatabox" x1="0%" y1="0%" x2="0%" y2="100%">
                                <stop offset="0%" stopColor={theme.colors.medium} />
                                <stop offset="80%" stopColor="rgba(255, 255, 255, 0)" />
                            </linearGradient>
                        </defs>

                        <rect
                            x={padding}
                            y={padding}
                            width={width - padding * 2}
                            height={Math.max(0, height - padding * 2)}
                            ry="12"
                            fill="rgba(0, 0, 0, 0.2)"
                            stroke="url(#fadeDatabox)"
                            strokeWidth="1"
                        />

                        <text
                            x={width / 2 - 1.5 * 155}
                            y={height / 2}
                            textAnchor="middle"
                            alignmentBaseline="middle"
                            fontSize={theme.typography.display1.fontSize}
                            fontFamily={theme.typography.display1.fontFamily}
                            fontWeight={theme.typography.caption2.fontWeight}
                            fill={themeColors.defaultColor}
                        >
                            {dashData.left.data as React.ReactNode}
                        </text>

                        <text
                            x={width / 2}
                            y={height / 2}
                            textAnchor="middle"
                            alignmentBaseline="middle"
                            fontSize={theme.typography.display1.fontSize}
                            fontFamily={theme.typography.display1.fontFamily}
                            fontWeight={theme.typography.caption2.fontWeight}
                            fill={toggle ? themeColors.blueHighlight : themeColors.inactiveColor}
                        >
                            {customMsg}
                        </text>

                        <text
                            x={width / 2 + 1.5 * 155}
                            y={height / 2}
                            textAnchor="middle"
                            alignmentBaseline="middle"
                            fontSize={theme.typography.display1.fontSize}
                            fontFamily={theme.typography.display1.fontFamily}
                            fontWeight={theme.typography.caption2.fontWeight}
                            fill={themeColors.defaultColor}
                        >
                            {dashData.right.data as React.ReactNode}
                        </text>
                    </Svg>
                )}
            </Databox>
        </Container>
    );
};

export default DataBox;

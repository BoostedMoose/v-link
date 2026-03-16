import styled, { useTheme } from 'styled-components';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';

import { DATA, APP, ModuleState, useThemeColor } from '@/store/Store';
import { Display3, Typography } from '@/theme/styles/Typography';

// Styled container for the gauge
const Container = styled.div`
    position: relative;
    height: 100%;
    width: 100%;
    flex: 1;
    display: flex;
    flex-direction: column;
    background: none;
    border-radius: 7px;
    align-self: flex-start;
`;

const Speed = styled.div`
    background: none;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, 0);
    gap: 5px;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
`;

const RPM = styled.div`
    background: none;
    position: absolute;
    bottom: 0px;
    right: 20px;
    gap: 5px;
    display: flex;
    align-items: flex-end;
`;

const Custom = styled.div`
    background: none;
    position: absolute;
    height: 40px;
    top: 20px;
    left: 20px;
    gap: 5px;
    display: flex;
    align-items: center;
`;

type ModuleSelector = ((select: (s: ModuleState) => unknown) => unknown) | undefined;

type SensorConfig = { unit?: string; max_value?: number; min_value?: number; limit_start?: number };

type DashRaceSettings = {
    gauge_1: { value: string; type: string };
    gauge_2: { value: string; type: string };
    gauge_3: { value: string; type: string };
};

// Helper function to format numbers to single decimal magnitude
const formatToSingleDecimal = (number: number): number => {
    if (number === 0) return 0;
    const magnitude = Math.floor(Math.log10(Math.abs(number)));
    const divisor = Math.pow(10, magnitude);
    return Math.floor(number / divisor);
};

const LinearGauge = () => {
    const theme = useTheme();
    const containerRef = useRef<HTMLDivElement>(null);

    const data = DATA((state) => state.data);

    const settings = APP((state) => state.settings.dash_race) as DashRaceSettings | undefined;
    const themeColor = useThemeColor();

    // Extract gauge settings at top level
    const progressName = settings?.gauge_1.value ?? '';
    const progressType = settings?.gauge_1.type ?? '';
    const topLeftName = settings?.gauge_2.value ?? '';
    const topLeftType = settings?.gauge_2.type ?? '';
    const centerName = settings?.gauge_3.value ?? '';
    const centerType = settings?.gauge_3.type ?? '';

    // Helper to safely get sensor config
    const getSensorConfig = (moduleSelector: ModuleSelector, sensorName: string | undefined): SensorConfig => {
        if (!moduleSelector || !sensorName) return {};
        const sensor = (moduleSelector as (select: (s: ModuleState) => unknown) => unknown)((state) => (state.settings.sensors as Record<string, unknown> | undefined)?.[sensorName]);
        return (sensor && typeof sensor === 'object') ? sensor as SensorConfig : {};
    };

    // Get modules selector functions
    const progressModuleSelector = APP((state) => state.modules[progressType] as ModuleSelector);
    const topLeftModuleSelector = APP((state) => state.modules[topLeftType] as ModuleSelector);
    const centerModuleSelector = APP((state) => state.modules[centerType] as ModuleSelector);

    // Use safe lookup
    const progressSensorConfig = getSensorConfig(progressModuleSelector, progressName);
    const topLeftSensorConfig = getSensorConfig(topLeftModuleSelector, topLeftName);
    const centerSensorConfig = getSensorConfig(centerModuleSelector, centerName);

    // Memoize data extraction to avoid repeated calculations
    const gaugeData = useMemo(() => {
        return {
            progress: {
                name: progressName,
                type: progressType,
                value: (data[progressName] ?? 0) as number,
                unit: progressSensorConfig.unit ?? 'N/A',
                maxValue: progressSensorConfig.max_value ?? 100,
                limitStart: progressSensorConfig.limit_start ?? 80,
                minValue: progressSensorConfig.min_value ?? 0,
            },
            topLeft: {
                value: (data[topLeftName] ?? 0) as number,
                unit: topLeftSensorConfig.unit ?? 'N/A',
            },
            center: {
                value: (data[centerName] ?? 0) as number,
                unit: centerSensorConfig.unit ?? 'N/A',
            }
        };
    }, [
        progressName, progressType, topLeftName, topLeftType, centerName, centerType,
        data, progressSensorConfig, topLeftSensorConfig, centerSensorConfig
    ]);

    // Import Typography styles (memoized to prevent object recreation)
    const typographyStyles = useMemo(() => ({
        Display4: Typography.Display4,
        Display3: Typography.Display3,
        Display1: Typography.Display1,
        Body1: Typography.Body1
    }), []);

    // Dimensions of the container
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const { width, height } = dimensions;

    // State variables for SVG content and rendering
    const [svg, setSVG] = useState<Document | null>(null);
    const [viewBox, setViewBox] = useState({ minX: 0, minY: 0, width: 0, height: 0 });
    const [bar, setBar] = useState<SVGGeometryElement | null>(null);
    const [spline, setSpline] = useState<SVGGeometryElement | null>(null);
    const [ready, setReady] = useState(false);

    // Configuration constants
    const padding = 20;
    const reverseMarkers = true;

    // Memoize scale calculation
    const scale = useMemo(() => {
        if (viewBox.width && viewBox.height && width && height) {
            return {
                x: (width - padding * 2) / viewBox.width,
                y: (height - padding * 2) / viewBox.height,
            };
        }
        return { x: 1, y: 1 };
    }, [width, height, viewBox]);

    // Memoized resize handler
    const handleResize = useCallback(() => {
        if (containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            setDimensions({
                width: rect.width,
                height: rect.height,
            });
        }
    }, []);

    /* Observe container resizing and update dimensions. */
    useEffect(() => {
        const resizeObserver = new ResizeObserver(handleResize);
        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
            handleResize(); // Initial measurement
        }
        return () => resizeObserver.disconnect();
    }, [handleResize]);

    /* Fetch and parse the SVG content. */
    useEffect(() => {
        const loadSVG = async () => {
            try {
                const response = await fetch('/assets/svg/gauges/race.svg');
                const svgText = await response.text();
                const svgDoc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
                setSVG(svgDoc);
            } catch (error) {
                console.error('Error fetching or parsing SVG:', error);
            }
        };

        loadSVG();
    }, []);

    /* Extract paths and viewBox details from the SVG. */
    useEffect(() => {
        if (svg) {
            const svgElement = svg.querySelector('svg');
            if (svgElement) {
                const viewBoxAttr = svgElement.getAttribute('viewBox');
                if (viewBoxAttr) {
                    const [minX, minY, width, height] = viewBoxAttr.split(' ').map(Number);
                    setViewBox({ minX, minY, width, height });
                }
            }

            setSpline(svg.getElementById('spline') as SVGGeometryElement | null);
            setBar(svg.getElementById('bar') as SVGGeometryElement | null);
            setReady(true);
        }
    }, [svg]);

    // Memoize marker calculations to avoid recalculating on every render
    const markerCalculations = useMemo(() => {
        if (!spline) return { limitPositions: [], maxPositions: [] };

        const { maxValue, limitStart, minValue } = gaugeData.progress;
        const pathLength = spline.getTotalLength();

        const calculatePositions = (markerEnd: number) => {
            const numIntervals = formatToSingleDecimal(markerEnd) - formatToSingleDecimal(minValue) + 1;
            const actualIntervals = numIntervals > 0 ? numIntervals : 1;
            const positions = [];

            const limitLength = pathLength * (markerEnd / maxValue);
            const intervalLength = actualIntervals > 1 ? limitLength / (actualIntervals - 1) : limitLength;

            for (let i = 0; i < actualIntervals; i++) {
                const lengthAtInterval = intervalLength * i;
                const adjustedPoint = reverseMarkers
                    ? spline.getPointAtLength(pathLength - lengthAtInterval)
                    : spline.getPointAtLength(lengthAtInterval);
                positions.push(adjustedPoint);
            }
            return positions;
        };

        return {
            limitPositions: calculatePositions(limitStart),
            maxPositions: calculatePositions(maxValue)
        };
    }, [spline, gaugeData.progress, reverseMarkers]);

    // Memoize gradient generators
    const gradientGenerators = useMemo(() => ({
        gradientDefault: (id: string, adjustedX: number) => (
            <linearGradient key={id} id={id} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop
                    offset="0%"
                    stopColor={theme.colors.theme[themeColor].default}
                    stopOpacity="1"
                />
                <stop
                    offset={`${((adjustedX - 1) / (width - padding * 2)) * 100}%`}
                    stopColor={theme.colors.theme[themeColor].default}
                    stopOpacity="1"
                />
                <stop
                    offset={`${(adjustedX / (width - padding * 2)) * 100}%`}
                    stopColor={theme.colors.light}
                    stopOpacity="0"
                />
            </linearGradient>
        ),

        gradientLight: (id: string, adjustedX: number) => (
            <linearGradient key={id} id={id} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop
                    offset="0%"
                    stopColor={theme.colors.theme[themeColor].active}
                    stopOpacity="1"
                />
                <stop
                    offset={`${((adjustedX - 1) / (width - padding * 2)) * 100}%`}
                    stopColor={theme.colors.theme[themeColor].active}
                    stopOpacity="1"
                />
                <stop
                    offset={`${(adjustedX / (width - padding * 2)) * 100}%`}
                    stopColor={theme.colors.light}
                    stopOpacity="0"
                />
            </linearGradient>
        ),

        gradientValue: (id: string, adjustedX: number) => (
            <linearGradient key={id} id={id} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop
                    offset="0%"
                    stopColor={theme.colors.theme[themeColor].default}
                    stopOpacity="1"
                />
                <stop
                    offset={`${((adjustedX - 30) / (width - padding * 2)) * 100}%`}
                    stopColor={theme.colors.theme[themeColor].active}
                    stopOpacity="1"
                />
                <stop
                    offset={`${((adjustedX - 15) / (width - padding * 2)) * 100}%`}
                    stopColor={theme.colors.theme[themeColor].active}
                    stopOpacity="1"
                />
                <stop
                    offset={`${((adjustedX - 1) / (width - padding * 2)) * 100}%`}
                    stopColor={theme.colors.light}
                    stopOpacity="1"
                />
                <stop
                    offset={`${(adjustedX / (width - padding * 2)) * 100}%`}
                    stopColor={theme.colors.light}
                    stopOpacity="0"
                />
            </linearGradient>
        ),

        gradientLimit: (id: string, value1: number, value2: number, color: string) => (
            <linearGradient key={id} id={id} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop
                    offset={`${((value1 - 1) / (width - padding * 2)) * 100}%`}
                    stopColor={color}
                    stopOpacity="0"
                />
                <stop
                    offset={`${((value1) / (width - padding * 2)) * 100}%`}
                    stopColor={color}
                    stopOpacity="1"
                />
                <stop
                    offset={`${((value2) / (width - padding * 2)) * 100}%`}
                    stopColor={color}
                    stopOpacity="1"
                />
                <stop
                    offset={`${((value2 + 1) / (width - padding * 2)) * 100}%`}
                    stopColor={color}
                    stopOpacity="0"
                />
            </linearGradient>
        )
    }), [theme.colors, themeColor, width, padding]);

    // Memoize SVG elements to prevent re-rendering
    const svgElements = useMemo(() => {
        if (!ready || !bar || !spline) return null;

        const { maxValue, limitStart, value: progressValue } = gaugeData.progress;
        const { limitPositions, maxPositions } = markerCalculations;

        const barPath = bar.getAttribute('d') ?? undefined;
        const splinePath = spline.getAttribute('d') ?? undefined;

        const renderBar = () => {
            if (limitPositions.length === 0) return null;
            const lastMarkerPosition = limitPositions[limitPositions.length - 1];
            const adjustedX = lastMarkerPosition.x * scale.x;

            return (
                <g key="bar">
                    <defs>
                        {gradientGenerators.gradientDefault('barGradient', adjustedX)}
                    </defs>
                    <path
                        d={barPath}
                        fill="url(#barGradient)"
                        stroke="none"
                        transform={`translate(${padding}, ${padding}) scale(${scale.x}, ${scale.y})`}
                    />
                </g>
            );
        };

        const renderSpline = () => {
            if (maxPositions.length === 0) return null;
            const lastMarkerPosition = maxPositions[maxPositions.length - 1];
            const adjustedX = padding + lastMarkerPosition.x * scale.x;

            return (
                <g key="spline">
                    <defs>
                        {gradientGenerators.gradientLight('splineGradient', adjustedX)}
                    </defs>
                    <path
                        d={splinePath}
                        fill="none"
                        stroke="url(#splineGradient)"
                        strokeWidth="6"
                        transform={`translate(${padding}, ${padding}) scale(${scale.x}, ${scale.y})`}
                    />
                </g>
            );
        };

        const renderMarkers = () => {
            return limitPositions.slice(0, -1).map((point, index) => {
                const startX = padding + point.x * scale.x;
                const startY = padding + point.y * scale.y;
                const endY = 12 + padding + point.y * scale.y;

                return (
                    <line
                        key={`marker-${index}`}
                        x1={startX}
                        y1={startY - 2}
                        x2={startX}
                        y2={endY}
                        stroke={theme.colors.theme[themeColor].active}
                        strokeWidth="8"
                    />
                );
            });
        };

        const renderLabels = () => {
            return maxPositions.slice(1).map((point, index) => {
                const labelX = padding + point.x * scale.x;
                const labelY = padding + point.y * scale.y;

                return (
                    <text
                        key={`label-${index}`}
                        x={labelX}
                        y={labelY + 30}
                        fontSize="12"
                        fontFamily="Arial, sans-serif"
                        fill="#DBDBDB"
                        textAnchor="middle"
                    >
                        {index + 1}
                    </text>
                );
            });
        };

        const renderScale = () => {
            if (maxPositions.length < 2) return null;
            const secondMarker = maxPositions[1];
            const labelX = padding + secondMarker.x * scale.x;
            const labelY = padding + secondMarker.y * scale.y;

            return (
                <text
                    key="scale"
                    x={labelX + 3}
                    y={labelY + 50}
                    fontSize="14"
                    fontFamily="Arial, sans-serif"
                    fontWeight="700"
                    fill="#DBDBDB"
                    textAnchor="middle"
                >
                    1/MIN x 1000
                </text>
            );
        };

        const renderRedline = () => {
            if (limitPositions.length === 0) return null;
            const lastMarkerPosition = limitPositions[limitPositions.length - 1];
            const adjustedX = lastMarkerPosition.x * scale.x;

            return (
                <g key="redline">
                    <defs>
                        {gradientGenerators.gradientLimit('limitRedline', adjustedX, 1000, theme.colors.theme[themeColor].highlightDark)}
                    </defs>
                    <path
                        d={splinePath}
                        fill="none"
                        stroke="url(#limitRedline)"
                        strokeWidth="6"
                        transform={`translate(${padding}, ${padding + 10}) scale(${scale.x}, ${scale.y})`}
                    />
                </g>
            );
        };

        const renderLimit = () => {
            const normalized1 = progressValue / maxValue;
            const totalWidth = width - padding * 2;
            const xEnd = normalized1 * totalWidth;
            const normalized2 = limitStart / maxValue;
            const xStart = normalized2 * totalWidth;

            return (
                <g key="limit">
                    <defs>
                        {gradientGenerators.gradientLimit('limitGradient', xStart, xEnd, '#FF0000')}
                        <filter id="glowEffectLimit" x="-50%" y="-50%" width="200%" height="200%">
                            <feGaussianBlur stdDeviation="60" result="blurredGlow" />
                            <feMerge>
                                <feMergeNode in="blurredGlow" />
                                <feMergeNode in="SourceGraphic" />
                            </feMerge>
                        </filter>
                    </defs>
                    <path
                        d={barPath}
                        fill="url(#limitGradient)"
                        stroke="none"
                        transform={`translate(${padding}, ${padding}) scale(${scale.x}, ${scale.y})`}
                        filter="url(#glowEffectLimit)"
                    />
                </g>
            );
        };

        const renderValue = () => {
            const value = progressValue < limitStart ? progressValue : progressValue;
            const normalizedValue = value / maxValue;
            const totalWidth = width - padding * 2;
            const xPosition = normalizedValue * totalWidth;

            return (
                <g key="value">
                    <defs>
                        {gradientGenerators.gradientValue('valueGradient', xPosition)}
                        <filter id="glowEffect" x="-50%" y="-50%" width="200%" height="200%">
                            <feGaussianBlur stdDeviation="60" result="coloredBlur" />
                            <feMerge>
                                <feMergeNode in="coloredBlur" />
                                <feMergeNode in="SourceGraphic" />
                            </feMerge>
                        </filter>
                    </defs>
                    <path
                        d={barPath}
                        fill="url(#valueGradient)"
                        stroke="none"
                        transform={`translate(${padding}, ${padding}) scale(${scale.x}, ${scale.y})`}
                        filter="url(#glowEffect)"
                    />
                </g>
            );
        };

        return {
            renderSpline,
            renderBar,
            renderMarkers,
            renderLabels,
            renderScale,
            renderLimit,
            renderRedline,
            renderValue
        };
    }, [ready, bar, spline, gaugeData, markerCalculations, scale, padding, width, height, theme.colors, themeColor, gradientGenerators]);

    return (
        <Container ref={containerRef}>
            {ready && svgElements && (
                <>
                    <svg width={width} height={height}>
                        {svgElements.renderSpline()}
                        {svgElements.renderBar()}
                        {svgElements.renderMarkers()}
                        {svgElements.renderLabels()}
                        {svgElements.renderScale()}
                        {gaugeData.progress.value > gaugeData.progress.limitStart && svgElements.renderLimit()}
                        {svgElements.renderRedline()}
                        {svgElements.renderValue()}
                    </svg>

                    <Speed>
                        <Display3>{Math.floor(gaugeData.center.value)}</Display3>
                        <typographyStyles.Display1
                            style={{
                                transform: 'translate(0px, 5px)',
                            }}>
                            {gaugeData.center.unit}
                        </typographyStyles.Display1>
                    </Speed>

                    <RPM
                        style={{
                            textShadow: '0px 0px 70px rgba(255, 255, 255, 0.3)'
                        }}>
                        <typographyStyles.Display4>{Math.floor(gaugeData.progress.value)}</typographyStyles.Display4>
                        <typographyStyles.Body1>{gaugeData.progress.unit}</typographyStyles.Body1>
                    </RPM>

                    <Custom>
                        <Display3>{gaugeData.topLeft.value}</Display3>
                        <typographyStyles.Body1>{gaugeData.topLeft.unit}</typographyStyles.Body1>
                    </Custom>
                </>
            )}
        </Container>
    );
};

export default LinearGauge;

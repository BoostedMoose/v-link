import React, { useState, useEffect, useRef } from 'react';
import styled, { useTheme } from 'styled-components';

import { DATA, APP, ModuleState, useThemeColor } from '@/store/Store';
import convert from 'color-convert';

// ── local setting-shape types ─────────────────────────────────────────────────
type SensorSetting = { value: string; type: string };
type DashChartsSettings = Record<string, SensorSetting>;
type SensorConfig = { label?: string; min_value?: number; max_value?: number };

interface Point { x: number; y: number }

interface DataChartProps {
    length?: number;
    resolution?: number;
    setCount: number;
    tickCountX: number;
    tickCountY: number;
    color_xGrid: string;
    color_yGrid: string;
}

const Container = styled.div`
    position: relative;
    height: 100%;
    width: 100%;
    flex: 1;
    display: flex;
    flex-direction: column;
    background: ${({ theme }) => `${theme.colors.gradients.gradient3}`};
    border-radius: 7px;
    overflow: hidden;
    align-self: flex-start;
`;

const RecordButton = styled.button`
    position: absolute;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    outline: none;
    display: flex;
    justify-content: center;
    align-items: center;

    &:hover {
        cursor: pointer;
    }
`;

const History = styled.div`
    background: none;
    position: absolute;
    bottom: 20px;
    right: 20px;
    display: flex;
    flex-direction: column;
`;

const DataChart = ({
    length = 2500,
    resolution = 100,
    setCount,
    tickCountX,
    tickCountY,
    color_xGrid,
    color_yGrid,
}: DataChartProps) => {
    const theme = useTheme();
    const steps = Math.trunc(length / resolution);

    const appUpdate = APP((state) => state.update);
    const modules = APP((state) => state.modules);
    const isRecording = APP((state) => state.system.isRecording);
    const dashChartsSettings = APP((state) => state.settings.dash_charts as DashChartsSettings | undefined);
    const themeColor = useThemeColor();

    const data = DATA((state) => state.data);

    const containerRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const { width, height } = dimensions;

    useEffect(() => {
        const handleResize = () => {
            if (containerRef.current) {
                setDimensions({
                    width: containerRef.current.offsetWidth,
                    height: containerRef.current.offsetHeight,
                });
            }
        };

        const resizeObserver = new ResizeObserver(handleResize);
        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
        }

        return () => {
            resizeObserver.disconnect();
        };
    }, []);

    const datasets = Array.from({ length: setCount }, (_, i) => {
        const key = `value_${i + 1}`;
        const setting = dashChartsSettings?.[key];
        const sensor = setting?.value ?? '';
        const type = setting?.type;

        const moduleSelector = type && sensor
            ? (modules[type] as ((select: (s: ModuleState) => unknown) => unknown) | undefined)
            : undefined;

        const config: SensorConfig = moduleSelector
            ? (moduleSelector((state: ModuleState) =>
                (state.settings.sensors as Record<string, unknown> | undefined)?.[sensor]
              ) as SensorConfig | undefined) ?? {}
            : {};

        const value = data[sensor];

        return {
            label: config.label ?? 'N/A',
            color: 'var(--themeDefault)',
            yMin: config.min_value ?? 0,
            yMax: config.max_value ?? 100,
            data: value ?? 0,
        };
    });


    // Initialize dataStreams with empty arrays for each dataset
    const [dataStreams, setDataStreams] = useState(datasets.map(() => Array(steps).fill(0)));

    const generateColors = () => {
        const baseColor = theme.colors.theme[themeColor].active.replace(/#/g, '');
        const hsbColor = convert.hex.hsv(baseColor);
        return datasets.map((_, i) => {
            const hue = (hsbColor[0] + i * 20) % 360;
            return `#${convert.hsv.hex([hue, hsbColor[1], hsbColor[2]])}`;
        });
    };

    const colors = generateColors();

    const renderGrid = () => {
        const xStep = width / tickCountX;
        const yStep = height / tickCountY;

        const gridLines = [];

        for (let i = 1; i < tickCountX; i++) {
            gridLines.push(
                <line
                    key={`x-${i}`}
                    x1={i * xStep}
                    y1={0}
                    x2={i * xStep}
                    y2={height}
                    stroke={color_xGrid}
                    strokeWidth="1"
                />
            );
        }

        for (let i = 1; i < tickCountY; i++) {
            gridLines.push(
                <line
                    key={`y-${i}`}
                    x1={0}
                    y1={i * yStep}
                    x2={width}
                    y2={i * yStep}
                    stroke={color_yGrid}
                    strokeWidth="1"
                />
            );
        }

        return gridLines;
    };

    const catmullRomSpline = (p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point => {
        const t2 = t * t;
        const t3 = t2 * t;

        const f0 = -t3 + 2 * t2 - t;
        const f1 = 3 * t3 - 5 * t2 + 2;
        const f2 = -3 * t3 + 4 * t2 + t;
        const f3 = t3 - t2;

        const x = 0.5 * (p0.x * f0 + p1.x * f1 + p2.x * f2 + p3.x * f3);
        const y = 0.5 * (p0.y * f0 + p1.y * f1 + p2.y * f2 + p3.y * f3);

        return { x, y };
    };

    const renderCurve = () => {
        const leftOffset = -5;
        const rightOffset = -5;

        const paths = datasets.map((dataset, i) => {
            const points: Point[] = [];
            const yScale = height / (dataset.yMax - dataset.yMin);

            dataStreams[i].forEach((value, j) => {
                if (value !== null) {
                    const x = ((j / (steps - 2)) * width) + leftOffset;
                    const y = height - (value - dataset.yMin) * yScale;
                    points.push({ x, y });
                }
            });

            let pathData = '';
            for (let j = 1; j < points.length - 2; j++) {
                const p0 = points[j - 1];
                const p1 = points[j];
                const p2 = points[j + 1];
                const p3 = points[j + 2];

                for (let t = 0; t <= 1; t += 0.1) {
                    const point = catmullRomSpline(p0, p1, p2, p3, t);
                    pathData += j === 1 && t === 0 ? `M${point.x},${point.y}` : `L${point.x},${point.y}`;
                }
            }

            pathData += `L${width + rightOffset},${points[points.length - 1].y}`;
            return (
                <React.Fragment key={`path-${i}`}>
                    <defs key={`defs-${i}`}>
                        {/* Horizontal Gradient */}
                        <linearGradient id={`gradient-${i}`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={width} y2="0">
                            <stop offset="0%" stopColor="#DBDBDB" />
                            <stop offset="5%" stopColor={colors[i]} />
                            <stop offset="40%" stopColor={colors[i]} />
                            <stop offset="100%" stopColor={theme.colors.dark} />
                        </linearGradient>

                        {/* Vertical Gradient to highlight values near yMax */}
                        <linearGradient id={`vertical-gradient-${i}`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={height}>
                            {/* Transparent to red as it approaches yMax */}
                            <stop offset="0%" stopColor="transparent" />
                            <stop
                                offset={(() => {
                                    const offsetValue = (height - (dataset.yMax - dataset.yMin) * yScale) / height;
                                    return isNaN(offsetValue) || offsetValue < 0 || offsetValue > 1
                                        ? 0 // Default to 0 if invalid
                                        : offsetValue;
                                })()}
                                stopColor="rgba(255, 0, 0, 1)"
                            />
                            <stop offset="100%" stopColor="transparent" />
                        </linearGradient>
                    </defs>

                    {/* Horizontal path with gradient */}
                    <path
                        key={`horizontal-path-${i}`}
                        d={pathData}
                        fill="none"
                        stroke={`url(#gradient-${i})`}
                        strokeWidth="3"
                    />

                    {/* Vertical gradient path */}
                    <path
                        key={`vertical-path-${i}`}
                        d={pathData}
                        fill="none"
                        stroke={`url(#vertical-gradient-${i})`}
                        strokeWidth="4"
                        strokeOpacity="0.5"
                    />
                </React.Fragment>
            );
        });

        return <>{paths}</>;
    };

    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
        }

        timerRef.current = setInterval(() => {
            const newDataStreams = datasets.map((dataset, index) => {
                let value = Math.abs(dataset.data as number);
                if (isNaN(value)) value = 0;
                value = Math.max(dataset.yMin, Math.min(dataset.yMax, value));

                return [value, ...dataStreams[index].slice(0, steps - 1)];
            });

            setDataStreams(newDataStreams);
        }, resolution);

        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current);
            }
        };
    }, [dataStreams]);

    const handleToggleRecording = () => {
        appUpdate((state) => {
            state.system.isRecording = !isRecording;
        });
    };

    return (
        <Container ref={containerRef}>
            <svg width={width} height={height}>
                {renderGrid()}
                {renderCurve()}
            </svg>

            <History>
                {datasets.map((dataset, i) => (
                    <div
                        key={`${dataset.label}-${i}`}
                        style={{
                            color: colors[i],
                            borderRadius: '5px',
                            fontSize: '14px',
                            textAlign: 'right',
                        }}
                    >
                        {dataset.label}
                    </div>
                ))}
            </History>

            <RecordButton onClick={handleToggleRecording}>
                <svg
                    width="50"
                    height="50"
                    viewBox="0 0 50 50"
                    xmlns="http://www.w3.org/2000/svg"
                    style={{
                        fill: isRecording ? 'red' : color_xGrid,
                        borderRadius: '50%',
                        stroke: '#141414',
                        strokeWidth: 4,
                    }}
                >
                    <circle cx="25" cy="25" r="16" />
                    <circle cx="25" cy="25" r="8" fill={isRecording ? 'red' : color_xGrid} />
                </svg>
            </RecordButton>
        </Container>
    );
};

export default DataChart;

import React from 'react';
import { useState, useEffect } from 'react';

const LineChart = ({
    label,
    width,
    height,
    padding,
    yMin,
    yMax,
    tickCountX,
    tickCountY,
    settings,
    carData,
    length
}) => {

    const [dataStream, setDataStream] = useState(Array.from({ length: length }, (_, index) => yMin));

    useEffect(() => {
        let value = carData;
        if (value > yMax) value = yMax;
        if (value < yMin) value = yMin;
        setDataStream((prevDataStream1) => [value, ...prevDataStream1.slice(0, length - 1)]);
    }, [carData, length, yMax, yMin]);


    const xData = Array.from({ length: length }, (_, index) => index + 1)

    // find the minimum and maximum values for the x data
    const xMin = Math.min(...xData);
    const xMax = Math.max(...xData);

    // calculate the x and y scales
    const xScale = (width - padding * 2) / (xMax - xMin);
    const yScale = (height - padding * 2) / (yMax - yMin);

    // create the data points for the line chart
    const dataPoints = xData.map((value, index) => ({
        x: (value - xMin) * xScale + padding,
        y: (yMax - dataStream[index]) * yScale + padding
    }));


    // create the path string for the line
    const path = dataPoints.reduce(
        (acc, point, index) =>
            index === 0 ? `M ${point.x} ${point.y}` : `${acc} L ${point.x} ${point.y}`,
        ''
    );

    // create the path string for the y axis
    const yAxis = `M ${padding} ${height - padding} L ${padding} ${padding}`;


    // create the path string and labels for the x axis ticks
    const xTicks = [];
    const tickDistance = (xMax - xMin) / tickCountX;
    for (let i = 0; i <= tickCountX; i++) {
        const xTick = xMin + i * tickDistance;
        const xTickPosition = (xTick - xMin) * xScale + padding;
        xTicks.push(
            <g key={i}>
                <path
                    d={`M ${xTickPosition} ${padding} L ${xTickPosition} ${height - padding}`}
                    stroke="var(--fillInactive)"
                    strokeWidth="1"
                    fill="none"
                />
                <text
                    x={xTickPosition}
                    y={height - padding + 15}
                    fontSize="14"
                    fill="white"
                    textAnchor="middle"
                >
                    {/*Number(xTick).toFixed(2)*/}
                </text>
            </g>
        );
    }


    // create the path string and labels for the y axis ticks
    const yTicks = [];
    const yTickDistance = (yMax - yMin) / tickCountY;
    for (let i = 0; i <= tickCountY; i++) {
        const yTick = yMin + i * yTickDistance;
        const yTickPosition = height - ((yTick - yMin) * yScale + padding);

        yTicks.push(
            <g key={i}>
                <path
                    d={`M ${padding} ${yTickPosition} L ${width - padding} ${yTickPosition}`}
                    stroke="var(--fillInactive)"
                    strokeWidth="1"
                    fill="none"
                />
                <text
                    x={padding - 10}
                    y={yTickPosition}
                    fontSize="14"
                    fill="white"
                    textAnchor="end"
                    dominantBaseline="middle"
                >
                    {yTick}
                </text>
            </g>
        );
    }

    return (
        <div className={`swiper ${settings.colorTheme}`} style={{ display: "flex", alignItems: "flex-start", gap: "1rem" }}>
            <div className="values">
                <div className="values__label" style={{ color: "var(--textColorHover)" }}>
                    <h4>{label}:</h4>
                </div>
                <div className="values__data" style={{ color: "var(--fillActive)", marginTop: "-1rem" }}>
                    <h3>{parseFloat(dataStream[0]).toFixed(2)}</h3>
                </div>
            </div>
            <div className="chart">
                <svg width={width} height={height}>
                    <path d={yAxis} stroke="white" strokeWidth="2" fill="none" />
                    {yTicks}
                    {xTicks}
                    <path d={path} stroke="var(--fillActive)" strokeWidth="2" fill="none" />
                </svg>
            </div>
        </div>
    );
};

export default LineChart;

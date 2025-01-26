import { DATA, APP } from '../../store/Store';
import styled, { useTheme } from 'styled-components';
import { useState, useEffect, useRef } from 'react';
import * as d3 from 'd3';


const cos = Math.cos;
const sin = Math.sin;
const π = Math.PI;

const f_matrix_times = (([[a, b], [c, d]], [x, y]) => [a * x + b * y, c * x + d * y]);
const f_rotate_matrix = (x => [[cos(x), -sin(x)], [sin(x), cos(x)]]);
const f_vec_add = (([a1, a2], [b1, b2]) => [a1 + b1, a2 + b2]);

// Helper function to format numbers to single decimal magnitude
const formatToSingleDecimal = (number) => {
    if (number === 0) return "0";
    const magnitude = Math.floor(Math.log10(Math.abs(number)));
    const divisor = Math.pow(10, magnitude);
    return Math.floor(number / divisor);
};

const calculateIncrement = (value) => {
    const magnitude = Math.floor(Math.log10(Math.abs(value)));

    // Determine step size based on the magnitude of the value
    if (value <= 30) {
        return 1; // Steps of 1 for values below 10
    } else if (value > 30 && value < 100) {
        return 10; // Steps of 10 for values between 10 and 200
    } else if (value >= 100 && value < 500) {
        return 20; // Steps of 100 for values between 200 and 1000
    } else if (value >= 500 && value < 1000) {
        return 100; // Steps of 100 for values between 200 and 1000
    } else if (value >= 1000 && value < 10000) {
        return 1000; // Steps of 1000 for values between 1000 and 10000
    } else {
        return Math.pow(10, magnitude - 2); // Steps of 10000 or larger for very large values
    }
};

const Container = styled.div`
    position: relative;
    height: 100%;
    width: 100%;
    flex: 1;
    display: flex;
    flex-direction: column;
    background: none;
    border-radius: 7px;
    overflow: hidden;
    align-self: flex-start;
    justify-content: flex-end;
    align-items: center;
    padding-top: 10px;
    box-sizing: border-box;
`;

export const RadialGauge = ({
    sensor,
    type,
    bars = true,
    showLabels = true,
}) => {

    // Load Settings
    const modules = APP((state) => state.modules);
    const data = DATA((state) => state.data)
    const theme = useTheme()

    let value = data[sensor]

    // Load interface config based on type
    const store = modules[type];
    const settings = store ? store((state) => state.settings.sensors[sensor]) : {};
    const label = settings.label

    const maxValue = settings.max_value
    const minValue = settings.min_value
    const limitStart = settings.limit_start

    const app = APP((state) => state.settings)
    const themeColor = (app.general.colorTheme.value).toLowerCase()


    /* Update scale factors whenever the dimensions or viewBox changes. */
    // State variables for SVG content and rendering


    // Dimensions of the container
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const [mainRadius, setMainRadius] = useState(0);

    const padding = 40;
    const containerRef = useRef(null);

    /* Observe container resizing and update dimensions. */
    useEffect(() => {
        const handleResize = () => {
            if (containerRef.current) {
                setDimensions({
                    width: containerRef.current.offsetWidth,
                    height: containerRef.current.offsetHeight,
                });
                setMainRadius((containerRef.current.offsetHeight - (padding * 2)) / 2)
            }
        };

        const resizeObserver = new ResizeObserver(handleResize);
        if (containerRef.current) resizeObserver.observe(containerRef.current);
        return () => resizeObserver.disconnect();
    }, []);





    // Center of Gauge
    const cx = dimensions.height / 2;
    const cy = dimensions.height / 2;

    // Main Arc
    const arcGap = 90;
    let mainArc = 360 - arcGap
    if (mainArc < 1) mainArc = 1


    // Circle declarations
    const outlineOffset = -7;
    const outlineRadius = mainRadius - outlineOffset


    if (isNaN(value)) value = minValue;
    if (value > maxValue) value = maxValue;
    if (value < minValue) value = minValue;


    const angleToRadians = (angle) => angle * π / 180;

    /* Calculate arc lengths in percentage */
    const percentFillerEnd = (value / maxValue) * 100;
    const percentLimitStart = (limitStart / maxValue) * 100;

    /* Calculate arc offset */
    // This value represents the angular offset required to center the main arc
    // (and any associated arcs within the gauge).
    const arcOffset = (360 - mainArc) / 2;


    /* Calculate Radians */
    // Order of these variables is important
    let progressArc = angleToRadians(mainArc * (percentFillerEnd / 100));
    let limitArc = angleToRadians(mainArc * (percentLimitStart / 100));
    mainArc = angleToRadians(mainArc) % (2 * π);


    // Adjust Rotation
    const mainRotationAngle = 90
    const mainRotationRadian = angleToRadians(mainRotationAngle + arcOffset)

    const rotMatrix = f_rotate_matrix(mainRotationRadian);

    /* Calculate Arcs */
    const computeCoordinates = (angle, mainRadius) => {
        const vector = [mainRadius * cos(angle), mainRadius * sin(angle)];
        const rotatedVector = f_matrix_times(rotMatrix, vector);
        return f_vec_add(rotatedVector, [cx, cy]);
    };


    const computeFlags = (arc, threshold) => {
        const fA = ((arc > threshold) ? 1 : 0); //Larger Arc : Smaller Arc
        const fS = ((arc > 0) ? 1 : 0); //Clockwise : Counterclockwise
        return (`${fA} ${fS}`)
    };

    //   d={generateArc(progressArc, 0, outlineRadius, 0, limitArc, mainArc)}

    const generateArc = (arcAngle, arcOffset, arcRadius, radiusOffset, reference, threshold) => {
        const radius = arcRadius + radiusOffset

        const [sx, sy] = computeCoordinates(0 + arcOffset, radius);
        const [ex, ey] = computeCoordinates(0 + arcAngle, radius);

        /* Returns d-attribute with start point, size, arclength, orientation and end point */
        return (
            `M ${sx},${sy}
             A ${radius},${radius},${arcAngle / (2 * π) * 360},
             ${computeFlags(reference, threshold)}
             ${ex},${ey}`
        )
    }


    const generateMarkerGradient = (index, totalMarkers, progressArc) => {
        // Find the position of the lightest color (corresponding to progressArc)
        const lightestPosition = Math.floor((progressArc / mainArc) * totalMarkers);

        // Now, create a color scale where the lightest color corresponds to the progressArc position
        const colorScale = d3.scaleLinear()
            .domain([0, lightestPosition, totalMarkers - 1])  // Domain from start, progress arc, to end
            .range([theme.colors.theme[themeColor].default, (data[sensor] > limitStart ? theme.colors.theme[themeColor].highlightLight : theme.colors.theme[themeColor].active)]);  // Dark to active to light

        const color = colorScale(index);  // Get color based on the index

        return color;  // Return color for the current marker
    };


    // Modify the `generateMarkers` function to include the gradient effect
    const generateMarkers = (markerStart, markerEnd, markerWidth, markerCount) => {
        const markers = [];
        const angleStep = mainArc / markerCount; // Angle step for all markers along the main arc
        const maxMarkers = Math.floor((progressArc / mainArc) * markerCount); // Only draw markers up to progressArc

        // Iterate over and generate markers up to the current value
        for (let i = 0; i <= maxMarkers; i++) {
            const angle = i * angleStep;
            const start = computeCoordinates(angle, mainRadius - markerStart);
            const end = computeCoordinates(angle, mainRadius - markerEnd);

            markers.push({
                x1: start[0],
                y1: start[1],
                x2: end[0],
                y2: end[1],
                index: i
            });
        }
        return markers;
    };



    const generateTextLabels = () => {
        const labelOffset = -(mainRadius / 4);  // Distance from the center to place the labels
        const increment = calculateIncrement(maxValue); // Calculate increment size based on maxValue
        const numLabels = Math.floor(maxValue / increment) + 1; // Calculate how many labels to generate
        const labels = [];
        const angleStep = mainArc / (numLabels - 1);  // Calculate angle for each label position

        for (let i = 0; i < numLabels; i++) {
            const angle = i * angleStep;
            const [x, y] = computeCoordinates(angle, mainRadius - labelOffset);
            const labelValue = minValue + (i / (numLabels - 1)) * (maxValue - minValue);  // Calculate label value

            // Store label data as an object, not JSX
            labels.push({
                x,
                y,
                labelValue: labelValue.toFixed(0), // Store label value as string (formatted)
            });
        }
        return labels;
    };


    useEffect(() => {
        if (containerRef.current) {
            const svg = d3.select(containerRef.current).select("svg");

            // Reset the SVG elements that need updating only (arc paths)
            svg.selectAll(".valueLabel").remove()
            svg.selectAll(".outlineArc").remove();
            svg.selectAll(".backgroundArc").remove();
            svg.selectAll(".progressArc").remove();
            svg.selectAll(".limitArc").remove();
            svg.selectAll(".marker").remove();
            svg.selectAll(".label").remove(); // Remove previous labels

            svg.append("defs")
                .append("linearGradient")
                .attr("id", "progressGradient")
                .attr("x1", "0%")
                .attr("y1", "100%")
                .attr("x2", "100%")
                .attr("y2", "0%")
                .append("stop")
                .attr("offset", "0%")
                .attr("stop-color", theme.colors.theme[themeColor].default)  // Starting color
                .append("stop")
                .attr("offset", "100%")
                .attr("stop-color", theme.colors.theme[themeColor].light); // Ending color

            // Add the main arc as background
            svg
                .append("path")
                .attr("class", "backgroundArc")
                .attr("d", generateArc(mainArc, 0, mainRadius, 0, mainArc, π))
                .attr("fill", "none")
                .attr("stroke", theme.colors.dark)
                .attr("stroke-width", 5);

            // Add outline arc path
            svg
                .append("path")
                .attr("class", "outlineArc")
                .attr("d", generateArc(progressArc, 0, outlineRadius, 0, progressArc, π))
                .attr("fill", "none")
                .attr("stroke", theme.colors.light)
                .attr("stroke-width", 2);

            // Add limit arc path
            svg
                .append("path")
                .attr("class", "limitArc")
                .attr("d", generateArc(mainArc, limitArc, outlineRadius, 0, limitArc, mainArc))
                .attr("fill", "none")
                .attr("stroke", theme.colors.theme[themeColor].highlightDark)
                .attr("stroke-width", 3);

            const progressCount = 140 // Total number of markers
            const progressStart = -2 // Distance from the center for marker start
            const progressEnd = 2   // Distance from the center for marker end
            const progressWidth = 3 // Width of the markers
            const progress = svg.selectAll(".marker").data(generateMarkers(progressStart, progressEnd, progressWidth, progressCount)); //markerStart, markerEnd, markerWidth, markerCount
            progress.exit().remove(); // Remove old markers


            progress
                .enter()
                .append("line")
                .attr("class", "progressArc")
                .attr("x1", (d) => d.x1)
                .attr("y1", (d) => d.y1)
                .attr("x2", (d) => d.x2)
                .attr("y2", (d) => d.y2)
                .attr("stroke", (d, i) => generateMarkerGradient(i, 130, progressArc))  // Apply gradient // 
                .attr("stroke-width", progressWidth)
                .attr("opacity", 1); // Fade-in effect

            progress
                .transition()
                .duration(1000)
                .attr("x1", (d) => d.x1)
                .attr("y1", (d) => d.y1)
                .attr("x2", (d) => d.x2)
                .attr("y2", (d) => d.y2)
                .attr("stroke", (d, i) => generateMarkerGradient(i, 130, progressArc));  // Apply gradient in transition

            // Add markers with gradient color effect
            if (bars) {
                const markerCount = 60 // Total number of markers
                const markerStart = 7 // Distance from the center for marker start
                const markerEnd = 20   // Distance from the center for marker end
                const markerWidth = 3 // Width of the markers
                const markers = svg.selectAll(".marker").data(generateMarkers(markerStart, markerEnd, markerWidth, markerCount)); //markerStart, markerEnd, markerWidth, markerCount
                markers.exit().remove(); // Remove old markers

                markers
                    .enter()
                    .append("line")
                    .attr("class", "marker")
                    .attr("x1", (d) => d.x1)
                    .attr("y1", (d) => d.y1)
                    .attr("x2", (d) => d.x2)
                    .attr("y2", (d) => d.y2)
                    .attr("stroke", (d) => theme.colors.medium)  // Apply gradient // 
                    .attr("stroke-width", markerWidth)
                    .attr("opacity", 1); // Fade-in effect

                markers
                    .transition()
                    .duration(1000)
                    .attr("x1", (d) => d.x1)
                    .attr("y1", (d) => d.y1)
                    .attr("x2", (d) => d.x2)
                    .attr("y2", (d) => d.y2)
                    .attr("stroke", (d, i) => generateMarkerGradient(i, markerCount, progressArc));  // Apply gradient in transition
            }

            // Add text labels
            const labels = svg.selectAll(".label").data(generateTextLabels());


            if (showLabels) {
                // Remove old labels
                labels.exit().remove();

                // Add new labels
                const labelEnter = labels
                    .enter()
                    .append("text")
                    .attr("class", "label")
                    .attr("fill", theme.colors.light)
                    .attr("font-size", (0.5 / 10) * dimensions.height) // Increased font size for visibility
                    .attr("text-anchor", "middle")
                    .attr("dominant-baseline", "middle")
                    .attr("opacity", 1) // Ensure visibility
                    .text((d) => {
                        // Check if labelValue is above 4 digits
                        const value = d.labelValue;
                        if (value.toString().length > 3) {
                            return value.toString()[0]; // Take only the first digit
                        }
                        return value; // Otherwise, keep the original value
                    });

                // Animate the position of the labels
                labelEnter
                    .attr("x", (d) => d.x)
                    .attr("y", (d) => d.y)
                    .transition()
                    .duration(1000) // Transition duration for smooth update
                    .attr("x", (d) => d.x)
                    .attr("y", (d) => d.y);
            }

            // Add unit label
            svg.append("text")
                .attr("class", "valueLabel")
                .attr("fill", theme.colors.light)
                .attr("font-size", (0.75 / 10) * dimensions.height)
                .attr("x", "50%")
                .attr("y", "52%")
                .attr("dy", "20px")
                .attr("text-anchor", "middle")
                .text(settings.unit);

            // Add value label
            svg.append("text")
                .attr("class", "valueLabel")
                .attr("fill", theme.colors.light)
                .attr("font-size", (1.2 / 10) * dimensions.height)
                .attr("x", "50%")
                .attr("y", "42%")
                .attr("dy", "20px")
                .attr("text-anchor", "middle")
                .text(data[sensor]);

        }
    }, [dimensions, progressArc, bars]); // Re-run whenever progressArc, dimensions, or bars change








    return (
        <Container ref={containerRef}>
            <svg height={dimensions.height} width={dimensions.height}>
                {/* Future SVG elements will be added dynamically via D3 */}
            </svg>
        </Container>
    );

};

export default RadialGauge;
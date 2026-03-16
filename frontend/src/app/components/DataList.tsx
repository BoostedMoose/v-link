import styled, { useTheme } from 'styled-components';
import { DATA, APP, ModuleState, useThemeColor } from '@/store/Store';
import { Typography } from '@/theme/styles/Typography';
import { CustomIcon } from '@/theme/styles/Icons';



const Container = styled.div`
  display: flex;

  justify-content: center;
  align-items: center;

  width: 100%;
  height: 100%;

  //background-image: url('/assets/svg/background/glow.svg#glow'); /* Corrected */
  //background-size: fit;  /* Adjust as needed */
  //background-repeat: no-repeat; /* Prevents repeating */
  //background-position: center; /* Centers the background */
`;

const List = styled.div`
  display: flex;

  height: 100%;
  width: 100%;

  box-sizing; border-box;
  padding-left: 20px;
  padding-right: 20px;
  gap: 20px;

  margin-bottom: 7px;
`

const Svg = styled.svg`
  width: 200px;
  height: 60px;
  border-radius: 12px;  /* Rounded edges for the button */
`;

const Divider = styled.div`
  flex: 1 1 0px;
  border-bottom: 1px solid ${({ color }) => color};
  margin-left: 5px;
  margin-right: 5px;
  margin-bottom: 10px;
  align-self: flex-end;
`

const Element = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  flex-direction: row;

  height: 35px;
  width: 100%;

  margin-bottom: 7px;
`

type DashPageSettings = Record<string, { value: string; type: string }>;
type SensorConfig = { label?: string; unit?: string; limit_start?: number };

const DataList = (dashPage: DashPageSettings, itemCount: number, columns: number) => {
    const theme = useTheme();

    const data = DATA((state) => state.data);
    const modules = APP((state) => state.modules);
    const colorTheme = useThemeColor();

    const Body1 = Typography.Body1;

    const rows = [];
    const columnsToUse = itemCount === 1 ? 1 : columns; // Use 1 column if there's only one value
    const rowsPerColumn = Math.ceil(itemCount / columnsToUse); // Calculate rows per column dynamically

    const lists = Array.from({ length: columnsToUse }, (): number[] => []); // Create empty arrays based on the number of columns

    // Distribute the boxes into the appropriate number of lists
    for (let i = 0; i < itemCount; i++) {
        const columnIndex = i % columnsToUse; // Alternate between columns
        lists[columnIndex].push(i);
    }

    // Now render each column
    for (let colIndex = 0; colIndex < columnsToUse; colIndex++) {
        const columnBoxes = lists[colIndex];
        const columnRows = [];

        // Render rows for the current column
        for (let i = 0; i < rowsPerColumn; i++) {
            const boxIndex = columnBoxes[i];

            // Check if there is a valid value
            if (!isNaN(boxIndex)) {
                const dataName = dashPage[`value_${boxIndex + 1}`].value;
                const dataType = dashPage[`value_${boxIndex + 1}`].type;

                let sensor: SensorConfig = {};

                // safely fetch the sensor config
                if (dataType != "") {
                    const moduleSelector = modules[dataType] as
                        | ((select: (s: ModuleState) => unknown) => unknown)
                        | undefined;
                    sensor = (moduleSelector?.(
                        (state: ModuleState) =>
                            (state.settings.sensors as Record<string, unknown> | undefined)?.[dataName]
                    ) as SensorConfig | undefined) ?? {};
                }

                const dataLabel = sensor.label ?? "N/A";
                const dataUnit = sensor.unit ?? "";
                const dataLimit = sensor.limit_start ?? Infinity;
                const dataValue = (data[dataName] ?? "N/A") as string | number;
                const numericValue = data[dataName] as number;

                const valueBox = (
                    <Svg key={`value_${boxIndex + 1}`} viewBox={`0 0 ${theme.interaction.buttonWidth} 30`}>
                        <defs>
                            <linearGradient id="fadeBorder" x1="0%" y1="0%" x2="0%" y2="100%">
                                <stop offset="0%" stopColor={theme.colors.medium} />
                                <stop offset="80%" stopColor="rgba(255, 255, 255, 0)" />
                            </linearGradient>
                            <linearGradient id="fadeLimit" x1="0%" y1="0%" x2="0%" y2="100%">
                                <stop offset="0%" stopColor={theme.colors.theme[colorTheme].highlightDark} />
                                <stop offset="80%" stopColor="rgba(255, 255, 255, 0)" />
                            </linearGradient>
                        </defs>

                        <rect
                            x="0"
                            y="0"
                            width={`${theme.interaction.buttonWidth}px`}
                            height={`${theme.interaction.buttonHeight}px`}
                            rx="12"
                            ry="12"
                            fill="rgba(0, 0, 0, 0.2)"
                            stroke={
                                numericValue > dataLimit
                                    ? "url(#fadeLimit)"
                                    : "url(#fadeBorder)"
                            }
                            strokeWidth={numericValue > dataLimit ? 2 : 1}
                        />
                        {numericValue > dataLimit && (
                            <use
                                href={`/assets/svg/icons/data/${'err'}.svg#${'err'}`}
                                x="10"
                                y="7.5"
                                width="20"
                                height="20"
                                stroke={theme.colors.theme[colorTheme].highlightDark}
                                strokeWidth={3}
                            />
                        )}
                        <text
                            x="50%"
                            y="50%"
                            dy=".5em"
                            textAnchor="middle"
                            fontSize={theme.typography.display1.fontSize}
                            fontFamily={theme.typography.display1.fontFamily}
                            fontWeight={theme.typography.caption2.fontWeight}
                            fill={theme.colors.light}
                        >
                            {dataValue}
                            {dataUnit}
                        </text>
                    </Svg>
                );

                const label = (
                    <span
                        style={{
                            color:
                                numericValue > dataLimit
                                    ? theme.colors.theme[colorTheme].highlightDark
                                    : theme.colors.light,
                        }}
                    >
                        {dataLabel}
                    </span>
                );

                const divider = (
                    <Divider
                        color={
                            numericValue > dataLimit
                                ? theme.colors.theme[colorTheme].highlightDark
                                : theme.colors.medium
                        }
                    />
                );

                // For the left column (colIndex === 0): label -> divider -> valueBox
                // For the right column (colIndex === 1): valueBox -> divider -> label
                if (colIndex === 0) {
                    columnRows.push(
                        <Element key={`row_${boxIndex}`} style={{ flexDirection: "row" }}>
                            <Body1>{label}</Body1>
                            {divider}
                            {valueBox}
                        </Element>
                    );
                } else {
                    columnRows.push(
                        <Element key={`row_${boxIndex}`} style={{ flexDirection: "row" }}>
                            {valueBox}
                            {divider}
                            <Body1>{label}</Body1>
                        </Element>
                    );
                }
            }
        }

        // Add the column rows to the overall rows
        rows.push(
            <div
                key={`column_${colIndex}`}
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                    flex: 1,
                    width: "100%",
                }}
            >
                {columnRows}
            </div>
        );
    }

    // Return the layout with specified lists
    return (
        <Container>
            <List style={{ display: "flex", flexDirection: "row", gap: "20px" }}>
                {rows}
            </List>
        </Container>
    );
};

export default DataList;

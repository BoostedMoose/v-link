import { useState, useEffect } from 'react';
import styled, { useTheme } from 'styled-components';

import { APP } from '@/store/Store';

type DashChartsSettings = Record<string, { value: string | number; type: string }> & {
  length: { value: number };
  resolution: { value: number };
};
type ConstantsSettings = { chart_input_current: number };
type DashPageSettings = Record<string, { value: string; type: string }>;

import DataChart from '@/app/components/DataChart'
import DataList from '@/app/components/DataList'


const Container = styled.div`
  display: flex;
  flex-direction:column;
  gap: 30px;
  width: 100%;
  height: 100%;
`;

const Chart = styled.div`
  display: flex;
  height: 60%;
`;

const List = styled.div`
  display: flex;
  gap: 20px;
`;


const Charts = () => {
    const theme = useTheme()

    const dashChartsSettings = APP((state) => state.settings.dash_charts as DashChartsSettings | undefined);
    const setCount           = APP((state) => (state.settings.constants as ConstantsSettings | undefined)?.chart_input_current ?? 1);

    const Datalist = DataList((dashChartsSettings ?? {}) as DashPageSettings, setCount, 2) // Amount of Items, 2 Columns



    return (
        <Container>
          {
            <Chart>
                <DataChart
                    length={dashChartsSettings?.length?.value}
                    resolution={dashChartsSettings?.resolution?.value}
                    setCount={setCount}
                    tickCountX={5}  // Update with the desired number of X-axis ticks
                    tickCountY={4}  // Update with the desired number of Y-axis ticks
                    color_xGrid={theme.colors.dark}
                    color_yGrid={theme.colors.dark}
                />
            </Chart>
            }
            <List>
                {Datalist}
            </List>
        </Container>

    )
};

export default Charts;

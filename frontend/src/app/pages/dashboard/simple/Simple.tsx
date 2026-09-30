import { useState, useEffect } from 'react';
import styled, { useTheme } from 'styled-components';

import { APP } from '@/store/Store';

type DashSimpleSettings = Record<string, { value: string | number; type: string }> & {
  length: { value: number };
  resolution: { value: number };
};
type DashPageSettings = Record<string, { value: string; type: string }>;

import DataList from '@/app/components/DataList'


const Container = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 50px;
  width: 90%;
  height: 60%;
  background-color: #222222;
  border-radius: 25px;
  filter: drop-shadow(0px 0px 25px #111111);

  @media (max-width: 520px), (max-height: 300px) {
    width: 96%;
    height: 84%;
    gap: 4px;
    border-radius: 8px;
    filter: none;
  }
`;

const List = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
`;


const Simple = () => {
    const theme = useTheme()

    const dashSimpleSettings = APP((state) => state.settings.dash_simple as DashSimpleSettings | undefined);
    const setCount           = 8; //Max. Recommended Datapoints

    const Datalist = DataList((dashSimpleSettings ?? {}) as DashPageSettings, setCount, 2) // Amount of Items, 2 Columns



    return (
        <Container>
            <List>
                {Datalist}
            </List>
        </Container>

    )
};

export default Simple;

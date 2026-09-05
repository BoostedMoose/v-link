import styled from 'styled-components';

import LinearGauge from '@/app/components/LinearGauge';
import DataList from '@/app/components/DataList'

import { APP } from '@/store/Store';

const Container = styled.div`
  display: flex;
  flex-direction:column;
  gap: 30px;
  width: 100%;
  height: 100%;
  @media (max-width: 520px), (max-height: 300px) {
    gap: 4px;
    min-height: 0;
  }
`;
const Gauge = styled.div`
  height: 60%;
  width: 100%;
  gap: 20px;

  @media (max-width: 520px), (max-height: 300px) {
    flex: 0 0 54%;
    height: auto;
    min-height: 0;
    gap: 4px;
  }
`;

const List = styled.div`
  width: 100%;
  gap: 20px;

  @media (max-width: 520px), (max-height: 300px) {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
`;

const Race = () => {

	const dashRaceSettings = APP((state) => state.settings.dash_race as Record<string, { value: string; type: string }> | undefined);
	const Datalist = DataList(dashRaceSettings ?? {}, 6, 2) // Amount of Items, 2 Columns

	return (
		<Container>
			<Gauge>
				<LinearGauge />
			</Gauge>
			<List>
				{Datalist}
			</List>
		</Container>
	)
};


export default Race;

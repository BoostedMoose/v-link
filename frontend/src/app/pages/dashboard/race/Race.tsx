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
`;

const Gauge = styled.div`
  height: 60%;
  width: 100%;
  gap: 20px;
`;

const List = styled.div`
  width: 100%;
  gap: 20px;
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
import styled, { useTheme } from 'styled-components';

import LinearGauge from './../../../components/LinearGauge';
import DataList from '../../../components/DataList'

import { APP } from '../../../../store/Store';

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
  height: 40%;
  width: 100%;
  gap: 20px;
`;

const Race = () => {
	const app = APP((state) => state);

	const Datalist = DataList(app.settings.dash_race, 6, 2) // Amount of Items, 2 Columns

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
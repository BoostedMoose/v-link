import { useState, useEffect, useRef } from 'react'
import styled, { useTheme } from 'styled-components';

import { APP } from '@/store/Store';

import RadialGauge from '@/app/components/RadialGauge'
import DataBox from '@/app/components/DataBox'

type GaugeSetting = { value: string; type: string };
type DashClassicSettings = {
  gauge_1: GaugeSetting;
  gauge_2: GaugeSetting;
  gauge_3: GaugeSetting;
  gauge_4: GaugeSetting;
};


const Container = styled.div`
  display: flex; 
  flex-direction:column;
  width: 100%;
  height: 100%;
`;

const Gauges = styled.div`
  display: flex; 
  flex-direction: row;
  justify-content: space-between;
  align-items: flex-end;


  width: 100%;
  height: 60%;

  background-image: url(/assets/svg/background/horizon.svg#horizon);
  background-size: cover;
  background-repeat: no-repeat;
  background-position: center;
`;


const Classic = () => {

  const dashClassic = APP(state => state.settings.dash_classic as DashClassicSettings | undefined);
  const gauge1 = dashClassic?.gauge_1 ?? { value: '', type: '' };
  const gauge2 = dashClassic?.gauge_2 ?? { value: '', type: '' };
  const gauge3 = dashClassic?.gauge_3 ?? { value: '', type: '' };
  const gauge4 = dashClassic?.gauge_4 ?? { value: '', type: '' };

	const theme = useTheme()
	const Databox = DataBox()


	/* Observe container resizing and update dimensions. */
	const containerRef = useRef<HTMLDivElement | null>(null);
	    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });


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
		if (containerRef.current) resizeObserver.observe(containerRef.current);
		return () => resizeObserver.disconnect();
	}, []);

	return (
		<Container>
			<Gauges ref={containerRef}>
				<div style={{ height: '80%' }}>
					<RadialGauge
						sensor={gauge1.value}
						type={gauge1.type}
						bars={false}
						showLabels={false}
					/>
				</div>
				<RadialGauge
					sensor={gauge2.value}
					type={gauge2.type}
					
				/>
				<RadialGauge
					sensor={gauge3.value}
					type={gauge3.type}
				/>
				<div style={{ height: '80%' }}>
					<RadialGauge
						sensor={gauge4.value}
						type={gauge4.type}
						bars={false}
						showLabels={false}
					/>
				</div>
			</Gauges>
			<div
				style={{
					width: '100%',
					height: '35%',

					backgroundImage: 'url(/assets/svg/background/glow.svg#glow)', /* Corrected */
					backgroundSize: 'contain',
					backgroundRepeat: 'no-repeat',
					backgroundPosition: 'center',
				}}>
				{Databox}
			</div>

		</Container>
	)
};


export default Classic;
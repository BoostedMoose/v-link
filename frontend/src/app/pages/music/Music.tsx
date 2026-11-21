import { APP } from '@/store/Store';

import NowPlaying from './components/NowPlaying';

const Music = () => {
  const media = APP((state) => state.system.carplay.media);
  const phoneConnected = APP((state) => state.system.carplay.phone);
  const source = APP((state) => state.system.carplay.source);

  return <NowPlaying media={media} phoneConnected={phoneConnected} source={source} />;
};

export default Music;

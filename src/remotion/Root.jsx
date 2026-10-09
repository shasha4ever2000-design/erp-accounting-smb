import { Composition } from 'remotion';
import { HelloVideo } from './HelloVideo.jsx';

export function RemotionRoot() {
  return (
    <Composition
      id="HelloVideo"
      component={HelloVideo}
      durationInFrames={90}
      fps={30}
      width={1280}
      height={720}
      defaultProps={{ title: 'ERP Accounting' }}
    />
  );
}

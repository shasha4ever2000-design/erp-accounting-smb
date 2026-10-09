import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';

export function HelloVideo({ title }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center' }}>
      <h1 style={{ color: 'white', fontSize: 80, fontFamily: 'sans-serif', opacity }}>{title}</h1>
    </AbsoluteFill>
  );
}

import Svg, { Circle, Line, Polyline, Rect } from 'react-native-svg';
import type { Coordinate } from '../types';
import { colors } from '../theme';

/** A coordinate trace, with no invented roads or map tiles. */
export function RoutePreview({ points, width = 86, height = 86 }: {
  points: Coordinate[]; width?: number; height?: number;
}) {
  const validPoints = points.filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
  const latitude = validPoints[0]?.latitude ?? 0;
  const longitude = validPoints[0]?.longitude ?? 0;
  const longitudeScale = Math.max(Math.abs(Math.cos(latitude * Math.PI / 180)), 0.001);
  const projected = validPoints.map((point) => {
    // Keep routes crossing the date line continuous.
    const delta = ((point.longitude - longitude + 540) % 360) - 180;
    return { x: delta * longitudeScale, y: -point.latitude };
  });
  const xs = projected.map((point) => point.x);
  const ys = projected.map((point) => point.y);
  const minX = xs.length ? Math.min(...xs) : 0;
  const maxX = xs.length ? Math.max(...xs) : 0;
  const minY = ys.length ? Math.min(...ys) : 0;
  const maxY = ys.length ? Math.max(...ys) : 0;
  const padding = 15;
  const scale = Math.min((width - padding * 2) / Math.max(maxX - minX, 0.00001), (height - padding * 2) / Math.max(maxY - minY, 0.00001));
  const trace = projected.map((point) => ({
    x: (point.x - (minX + maxX) / 2) * scale + width / 2,
    y: (point.y - (minY + maxY) / 2) * scale + height / 2,
  }));
  const first = trace[0];
  const last = trace[trace.length - 1];

  return <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} accessible accessibilityLabel={`Recorded route with ${validPoints.length} location points`}>
    <Rect width={width} height={height} rx={11} fill="#102235" />
    {[1, 2, 3].map((step) => <Line key={`x-${step}`} x1={width * step / 4} x2={width * step / 4} y1={0} y2={height} stroke="#1B344A" strokeWidth={0.7} />)}
    {[1, 2, 3].map((step) => <Line key={`y-${step}`} y1={height * step / 4} y2={height * step / 4} x1={0} x2={width} stroke="#1B344A" strokeWidth={0.7} />)}
    {trace.length > 1 && <>
      <Polyline points={trace.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#1186FF33" strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
      <Polyline points={trace.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke={colors.blueLight} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
    </>}
    {first && <Circle cx={first.x} cy={first.y} r={4} fill="#DAF0FF" stroke={colors.blue} strokeWidth={2} />}
    {last && <Circle cx={last.x} cy={last.y} r={5} fill={colors.blue} stroke="#A5DDFF" strokeWidth={2} />}
  </Svg>;
}

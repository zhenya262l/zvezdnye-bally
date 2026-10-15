import Svg, { Circle, Path, Polygon, Rect } from 'react-native-svg';

type P = { color: string; size?: number };

const common = (color: string) => ({
  stroke: color,
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  fill: 'none',
});

export function StarIcon({ color, size = 26, filled }: P & { filled?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Polygon
        points="12,2.5 14.9,8.6 21.5,9.4 16.6,13.9 17.9,20.5 12,17.2 6.1,20.5 7.4,13.9 2.5,9.4 9.1,8.6"
        {...common(color)}
        fill={filled ? color : 'none'}
      />
    </Svg>
  );
}

export function BagIcon({ color, size = 26 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M5 8h14l-1.2 12H6.2L5 8z" {...common(color)} />
      <Path d="M9 10V6.5a3 3 0 0 1 6 0V10" {...common(color)} />
    </Svg>
  );
}

export function ChestIcon({ color, size = 26 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M3.5 11V9a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4v2" {...common(color)} />
      <Rect x={3.5} y={11} width={17} height={8.5} rx={1.5} {...common(color)} />
      <Rect x={10.5} y={10} width={3} height={4} rx={0.8} {...common(color)} />
    </Svg>
  );
}

export function PersonIcon({ color, size = 26 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={8} r={4} {...common(color)} />
      <Path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" {...common(color)} />
    </Svg>
  );
}

export function PenIcon({ color, size = 26 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M15.5 4.5l4 4L9 19l-5 1 1-5 10.5-10.5z" {...common(color)} />
      <Path d="M3.5 21.5h17" {...common(color)} />
    </Svg>
  );
}

export function KidsIcon({ color, size = 26 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={8} cy={8} r={3} {...common(color)} />
      <Circle cx={16.5} cy={8} r={3} {...common(color)} />
      <Path d="M2.5 19.5a5.5 5.5 0 0 1 11 0M11.5 15.2a5.5 5.5 0 0 1 10 4.3" {...common(color)} />
    </Svg>
  );
}

export function SlidersIcon({ color, size = 26 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4 6h16M4 12h16M4 18h16" {...common(color)} />
      <Circle cx={9} cy={6} r={2.2} {...common(color)} fill="#FFFFFF" />
      <Circle cx={15} cy={12} r={2.2} {...common(color)} fill="#FFFFFF" />
      <Circle cx={8} cy={18} r={2.2} {...common(color)} fill="#FFFFFF" />
    </Svg>
  );
}

export function HouseIcon({ color, size = 26 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M3.5 11L12 4l8.5 7" {...common(color)} />
      <Path d="M6 9.5V20h12V9.5" {...common(color)} />
      <Path d="M10 20v-5h4v5" {...common(color)} />
    </Svg>
  );
}

export function ShareIcon({ color, size = 26 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 3v12M8 7l4-4 4 4" {...common(color)} />
      <Path d="M6 11H5v9h14v-9h-1" {...common(color)} />
    </Svg>
  );
}

export function PlusSquareIcon({ color, size = 26 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={4} y={4} width={16} height={16} rx={4} {...common(color)} />
      <Path d="M12 8v8M8 12h8" {...common(color)} />
    </Svg>
  );
}

export function PhoneIcon({ color, size = 26 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={6.5} y={2.5} width={11} height={19} rx={2.5} {...common(color)} />
      <Path d="M10.5 18.5h3" {...common(color)} />
    </Svg>
  );
}

export function ChevronIcon({ color, size = 20 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M9 5l7 7-7 7" {...common(color)} />
    </Svg>
  );
}

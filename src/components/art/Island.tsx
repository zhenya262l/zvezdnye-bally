import Svg, { Circle, Ellipse, G, Path, Polygon } from 'react-native-svg';

import { brand } from '@/theme';

function star(cx: number, cy: number, r: number) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

/** Night-sea island scene in the style of the diary cover (original drawing). */
export function Island({ width = 300 }: { width?: number }) {
  const h = (width * 190) / 320;
  return (
    <Svg width={width} height={h} viewBox="0 0 320 190" accessibilityElementsHidden importantForAccessibility="no">
      <Polygon points={star(56, 34, 12)} fill={brand.sun} />
      <Polygon points={star(262, 24, 9)} fill={brand.sun} />
      <Polygon points={star(214, 56, 6)} fill={brand.sun} opacity={0.8} />
      <Polygon points={star(98, 70, 5)} fill={brand.sun} opacity={0.7} />
      <Circle cx={280} cy={74} r={3} fill="#FFFFFF" opacity={0.7} />
      <Circle cx={30} cy={84} r={2.5} fill="#FFFFFF" opacity={0.6} />
      {/* rocket */}
      <G transform="translate(236 70) rotate(35)">
        <Path d="M0 -22 C 9 -12, 9 6, 6 14 L -6 14 C -9 6, -9 -12, 0 -22 Z" fill="#FFFFFF" />
        <Circle cx={0} cy={-6} r={4} fill={brand.turquoise} />
        <Path d="M-6 6 L-12 16 L-6 14 Z M6 6 L12 16 L6 14 Z" fill={brand.coral} />
        <Path d="M-4 14 L0 24 L4 14 Z" fill={brand.sun} />
      </G>
      {/* island */}
      <Ellipse cx={160} cy={150} rx={88} ry={20} fill="#F6D58E" />
      <Path d="M150 148 C 150 120, 156 104, 168 86" stroke="#8A5A2B" strokeWidth={7} strokeLinecap="round" fill="none" />
      <Path d="M168 86 C 150 76, 132 80, 122 92 C 140 86, 152 88, 168 86 Z" fill={brand.leaf} />
      <Path d="M168 86 C 184 72, 204 74, 214 86 C 198 82, 184 82, 168 86 Z" fill={brand.leaf} />
      <Path d="M168 86 C 160 68, 166 56, 180 50 C 174 62, 172 72, 168 86 Z" fill="#43B97A" />
      <Path d="M168 86 C 186 92, 196 104, 196 116 C 188 104, 180 96, 168 86 Z" fill="#43B97A" />
      <Circle cx={162} cy={92} r={4} fill="#8A5A2B" />
      <Circle cx={170} cy={94} r={4} fill="#8A5A2B" />
      {/* hibiscus */}
      <G transform="translate(206 140)">
        {[0, 72, 144, 216, 288].map((a) => (
          <Ellipse key={a} cx={0} cy={-6} rx={4.5} ry={7} fill={brand.coral} transform={`rotate(${a})`} />
        ))}
        <Circle cx={0} cy={0} r={2.5} fill={brand.sun} />
      </G>
      {/* waves */}
      <Path d="M0 168 Q 20 158 40 168 T 80 168 T 120 168 T 160 168 T 200 168 T 240 168 T 280 168 T 320 168 V190 H0 Z" fill={brand.turquoise} />
      <Path d="M0 178 Q 20 170 40 178 T 80 178 T 120 178 T 160 178 T 200 178 T 240 178 T 280 178 T 320 178 V190 H0 Z" fill="#0E8FA0" />
    </Svg>
  );
}

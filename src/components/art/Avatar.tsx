import Svg, { Circle, Ellipse, G, Line, Path, Polygon } from 'react-native-svg';

// Original sea-animal avatars drawn for this app.
export const AVATARS = ['turtle', 'dolphin', 'octopus', 'starfish', 'crab', 'whale'] as const;
export type AvatarId = (typeof AVATARS)[number];

const DARK = '#123A5A';

function Eyes({ x1, x2, y, r = 3 }: { x1: number; x2: number; y: number; r?: number }) {
  return (
    <G>
      <Circle cx={x1} cy={y} r={r} fill={DARK} />
      <Circle cx={x2} cy={y} r={r} fill={DARK} />
      <Circle cx={x1 + r * 0.35} cy={y - r * 0.35} r={r * 0.35} fill="#FFFFFF" />
      <Circle cx={x2 + r * 0.35} cy={y - r * 0.35} r={r * 0.35} fill="#FFFFFF" />
    </G>
  );
}

function Turtle() {
  return (
    <G>
      <Ellipse cx={30} cy={40} rx={7} ry={5} fill="#7ED39A" />
      <Ellipse cx={70} cy={40} rx={7} ry={5} fill="#7ED39A" />
      <Ellipse cx={31} cy={72} rx={7} ry={5} fill="#7ED39A" />
      <Ellipse cx={69} cy={72} rx={7} ry={5} fill="#7ED39A" />
      <Circle cx={50} cy={25} r={11} fill="#7ED39A" />
      <Eyes x1={45.5} x2={54.5} y={23} r={2.4} />
      <Ellipse cx={50} cy={57} rx={23} ry={24} fill="#2FA36B" />
      <Polygon points="50,44 60,50 60,63 50,69 40,63 40,50" fill="#57C487" />
      <Path d="M50 44 L50 34 M60 50 L70 45 M60 63 L70 69 M40 63 L30 69 M40 50 L30 45 M50 69 L50 80" stroke="#57C487" strokeWidth={3} strokeLinecap="round" />
    </G>
  );
}

function Dolphin() {
  return (
    <G>
      <Path d="M49 34 L57 18 L62 37 Z" fill="#4A90D9" />
      <Path d="M22 62 L8 52 L11 70 Z" fill="#4A90D9" />
      <Path
        d="M20 62 C 28 38, 62 30, 79 44 C 84 48, 88 50, 93 49 C 89 56, 83 58, 77 57 C 63 68, 40 72, 20 62 Z"
        fill="#5DA9E9"
      />
      <Path d="M34 62 C 46 66, 62 64, 74 58 C 64 70, 44 72, 34 62 Z" fill="#D7ECFB" />
      <Circle cx={71} cy={46} r={3} fill={DARK} />
      <Circle cx={72} cy={45} r={1} fill="#FFFFFF" />
      <Path d="M80 53 C 84 55, 88 54, 90 52" stroke={DARK} strokeWidth={1.8} fill="none" strokeLinecap="round" />
    </G>
  );
}

function Octopus() {
  const legs = [
    'M32 54 C 26 64, 34 70, 26 80',
    'M43 58 C 40 68, 48 72, 42 84',
    'M57 58 C 60 68, 52 72, 58 84',
    'M68 54 C 74 64, 66 70, 74 80',
  ];
  return (
    <G>
      {legs.map((d) => (
        <Path key={d} d={d} stroke="#9B7BEA" strokeWidth={8} strokeLinecap="round" fill="none" />
      ))}
      <Ellipse cx={50} cy={40} rx={24} ry={22} fill="#9B7BEA" />
      <Circle cx={41} cy={40} r={6} fill="#FFFFFF" />
      <Circle cx={59} cy={40} r={6} fill="#FFFFFF" />
      <Circle cx={42} cy={41} r={3} fill={DARK} />
      <Circle cx={60} cy={41} r={3} fill={DARK} />
      <Circle cx={34} cy={50} r={3.5} fill="#FF97C2" opacity={0.8} />
      <Circle cx={66} cy={50} r={3.5} fill="#FF97C2" opacity={0.8} />
      <Path d="M45 51 Q 50 55, 55 51" stroke={DARK} strokeWidth={2} fill="none" strokeLinecap="round" />
    </G>
  );
}

function Starfish() {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 34 : 16;
    pts.push(`${(50 + r * Math.cos(a)).toFixed(1)},${(54 + r * Math.sin(a)).toFixed(1)}`);
  }
  return (
    <G>
      <Polygon points={pts.join(' ')} fill="#FFB347" stroke="#FFB347" strokeWidth={8} strokeLinejoin="round" />
      <Eyes x1={44} x2={56} y={50} r={3} />
      <Path d="M44 59 Q 50 64, 56 59" stroke={DARK} strokeWidth={2.2} fill="none" strokeLinecap="round" />
      <Circle cx={50} cy={30} r={2} fill="#FFE1A8" />
      <Circle cx={30} cy={50} r={2} fill="#FFE1A8" />
      <Circle cx={70} cy={50} r={2} fill="#FFE1A8" />
    </G>
  );
}

function Crab() {
  return (
    <G>
      {[0, 1, 2].map((i) => (
        <G key={i}>
          <Line x1={30} y1={60 + i * 5} x2={16} y2={64 + i * 7} stroke="#FF6F61" strokeWidth={4} strokeLinecap="round" />
          <Line x1={70} y1={60 + i * 5} x2={84} y2={64 + i * 7} stroke="#FF6F61" strokeWidth={4} strokeLinecap="round" />
        </G>
      ))}
      <Line x1={34} y1={52} x2={24} y2={40} stroke="#FF6F61" strokeWidth={5} strokeLinecap="round" />
      <Line x1={66} y1={52} x2={76} y2={40} stroke="#FF6F61" strokeWidth={5} strokeLinecap="round" />
      <Path d="M24 40 m -10 0 a 10 10 0 1 0 20 0 l -10 -2 Z" fill="#FF6F61" />
      <Path d="M76 40 m -10 0 a 10 10 0 1 0 20 0 l -10 -2 Z" fill="#FF6F61" />
      <Line x1={43} y1={50} x2={41} y2={36} stroke="#FF6F61" strokeWidth={3} />
      <Line x1={57} y1={50} x2={59} y2={36} stroke="#FF6F61" strokeWidth={3} />
      <Ellipse cx={50} cy={60} rx={24} ry={15} fill="#FF6F61" />
      <Circle cx={41} cy={34} r={6} fill="#FFFFFF" />
      <Circle cx={59} cy={34} r={6} fill="#FFFFFF" />
      <Circle cx={41} cy={35} r={3} fill={DARK} />
      <Circle cx={59} cy={35} r={3} fill={DARK} />
      <Path d="M44 63 Q 50 68, 56 63" stroke={DARK} strokeWidth={2.2} fill="none" strokeLinecap="round" />
    </G>
  );
}

function Whale() {
  return (
    <G>
      <Path d="M44 30 C 42 22, 36 20, 34 16 M44 30 C 46 22, 52 20, 54 16 M44 30 L44 18" stroke="#BFE6F5" strokeWidth={3} strokeLinecap="round" fill="none" />
      <Path d="M80 56 L94 44 L93 66 Z" fill="#2F6FD6" />
      <Path d="M16 58 C 16 42, 36 34, 56 36 C 74 38, 84 48, 84 58 C 84 70, 70 76, 50 76 C 30 76, 16 70, 16 58 Z" fill="#3B82F6" />
      <Path d="M24 64 C 36 72, 64 72, 78 64 C 72 74, 32 76, 24 64 Z" fill="#CFE3FF" />
      <Circle cx={34} cy={54} r={3} fill={DARK} />
      <Circle cx={35} cy={53} r={1} fill="#FFFFFF" />
      <Path d="M28 62 Q 34 66, 40 62" stroke={DARK} strokeWidth={2} fill="none" strokeLinecap="round" />
    </G>
  );
}

const DRAW: Record<AvatarId, () => React.JSX.Element> = {
  turtle: Turtle,
  dolphin: Dolphin,
  octopus: Octopus,
  starfish: Starfish,
  crab: Crab,
  whale: Whale,
};

export function Avatar({ id, color, size = 64 }: { id: string; color: string; size?: number }) {
  const Draw = DRAW[(AVATARS as readonly string[]).includes(id) ? (id as AvatarId) : 'turtle'];
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityElementsHidden importantForAccessibility="no">
      <Circle cx={50} cy={50} r={50} fill={color} opacity={0.22} />
      <Circle cx={50} cy={50} r={46} fill="#FFFFFF" opacity={0.65} />
      <Draw />
    </Svg>
  );
}

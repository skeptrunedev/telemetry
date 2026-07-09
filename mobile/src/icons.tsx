import Svg, { Path, Rect, Circle, Line } from "react-native-svg";

// Hand-inlined lucide glyphs (24x24 stroke icons) so the drawer/topbar match
// the web app without pulling in an icon library.
type P = { size?: number; color: string };
const base = (size = 20) =>
  ({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }) as const;

export const PanelLeftIcon = ({ size, color }: P) => (
  <Svg {...base(size)} stroke={color}>
    <Rect width={18} height={18} x={3} y={3} rx={2} />
    <Path d="M9 3v18" />
  </Svg>
);

export const SunIcon = ({ size, color }: P) => (
  <Svg {...base(size)} stroke={color}>
    <Circle cx={12} cy={12} r={4} />
    <Path d="M12 2v2" />
    <Path d="M12 20v2" />
    <Path d="m4.93 4.93 1.41 1.41" />
    <Path d="m17.66 17.66 1.41 1.41" />
    <Path d="M2 12h2" />
    <Path d="M20 12h2" />
    <Path d="m6.34 17.66-1.41 1.41" />
    <Path d="m19.07 4.93-1.41 1.41" />
  </Svg>
);

export const MessageSquareIcon = ({ size, color }: P) => (
  <Svg {...base(size)} stroke={color}>
    <Path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </Svg>
);

export const SquarePenIcon = ({ size, color }: P) => (
  <Svg {...base(size)} stroke={color}>
    <Path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <Path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />
  </Svg>
);

export const SearchIcon = ({ size, color }: P) => (
  <Svg {...base(size)} stroke={color}>
    <Circle cx={11} cy={11} r={8} />
    <Path d="m21 21-4.3-4.3" />
  </Svg>
);

export const TrashIcon = ({ size, color }: P) => (
  <Svg {...base(size)} stroke={color}>
    <Path d="M3 6h18" />
    <Path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <Path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <Line x1={10} x2={10} y1={11} y2={17} />
    <Line x1={14} x2={14} y1={11} y2={17} />
  </Svg>
);

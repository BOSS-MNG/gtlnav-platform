/**
 * Edge network map data for the marketing Global Infrastructure section.
 *
 * Used by `src/components/marketing/visualizations/edge-network-map.tsx` and
 * available to any future `/network` page so the topology stays in sync with
 * marketing illustrations.
 */

export const WORLD_DOTS: string[] = [
  ".............................................",
  "....##.........######.......####...##........",
  "..######.....#########.....######....####....",
  "..########..##########....########....####...",
  "...######...##########....########.....##....",
  "...#####.....#########.....########..####....",
  "....##.......########......######.....####...",
  "....##........######.......######......##....",
  ".....#.........#####........####.........#...",
  "......##........###..........##..........#...",
  ".......##........#............#..........##..",
  ".............................................",
];

export type Pop = {
  id: string;
  x: number;
  y: number;
  name: string;
  region: string;
  primary?: boolean;
};

export const POPS: Pop[] = [
  { id: "sfo", x: 90, y: 100, name: "San Francisco", region: "us-west" },
  { id: "iad", x: 210, y: 90, name: "Ashburn", region: "us-east", primary: true },
  { id: "gru", x: 230, y: 200, name: "São Paulo", region: "sa-east" },
  { id: "lhr", x: 410, y: 75, name: "London", region: "eu-west" },
  { id: "fra", x: 450, y: 80, name: "Frankfurt", region: "eu-central", primary: true },
  { id: "lis", x: 395, y: 115, name: "Lisbon", region: "eu-south" },
  { id: "los", x: 460, y: 145, name: "Lagos", region: "af-west" },
  { id: "cpt", x: 470, y: 200, name: "Cape Town", region: "af-south" },
  { id: "bom", x: 595, y: 115, name: "Mumbai", region: "ap-south" },
  { id: "sin", x: 690, y: 155, name: "Singapore", region: "ap-southeast", primary: true },
  { id: "nrt", x: 770, y: 95, name: "Tokyo", region: "ap-northeast" },
  { id: "syd", x: 760, y: 200, name: "Sydney", region: "ap-southeast-2" },
];

export const POP_BY_ID: Record<string, Pop> = Object.fromEntries(
  POPS.map((p) => [p.id, p]),
);

export const ROUTES: [string, string][] = [
  ["sfo", "iad"],
  ["sfo", "nrt"],
  ["iad", "lhr"],
  ["iad", "gru"],
  ["lhr", "fra"],
  ["fra", "bom"],
  ["lis", "los"],
  ["gru", "los"],
  ["bom", "sin"],
  ["sin", "nrt"],
  ["sin", "syd"],
  ["cpt", "bom"],
];

export function arcPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const arc = Math.min(120, Math.abs(dx) * 0.32 + 30);
  const cy = my - arc;
  return `M ${x1} ${y1} Q ${mx} ${cy} ${x2} ${y2}`;
}

declare module 'ngeohash' {
  export function encode(latitude: number, longitude: number, precision?: number): string;
  export function decode(hashstring: string): {
    latitude: number;
    longitude: number;
    error: { latitude: number; longitude: number };
  };
  export function neighbors(hashstring: string): string[];
  export function decode_bbox(hashstring: string): [number, number, number, number];
  export default { encode, decode, neighbors, decode_bbox };
}
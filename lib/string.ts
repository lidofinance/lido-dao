export function de0x(hex: string) {
  return hex.slice(0, 2) === "0x" ? hex.slice(2) : hex;
}

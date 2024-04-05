import { hexlify, randomBytes } from "ethers";

export function de0x(hex: string) {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

export function randomString(length: number) {
  return hexlify(randomBytes(length));
}

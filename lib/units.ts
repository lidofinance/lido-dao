import { parseUnits } from "ethers";

export function ether(value: string): bigint {
  return parseUnits(value, "ether");
}

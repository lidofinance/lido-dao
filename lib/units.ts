import { parseEther as ether, parseUnits } from "ethers";

export const ONE_ETHER = ether("1.0");

const shares = (value: bigint) => parseUnits(value.toString(), "ether");

const shareRate = (value: bigint) => parseUnits(value.toString(), 27);

const ETH = (value: number) => ether(value.toString());

export { ether, shares, shareRate, ETH };

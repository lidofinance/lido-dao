import { Wallet } from "ethers";

export function randomAddress() {
  return Wallet.createRandom().address;
}

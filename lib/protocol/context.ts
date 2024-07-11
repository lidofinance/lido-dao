import { ether, impersonate } from "lib";

import { discover } from "./discovery";
import type { ProtocolContext, ProtocolSigners, Signer } from "./types";

const getSigner = async (signer: Signer, balance = ether("100"), signers: ProtocolSigners) => {
  // @ts-expect-error TS7053
  const signerAddress = signers[signer] ?? signer;
  return impersonate(signerAddress, balance);
};

export const getProtocolContext = async (): Promise<ProtocolContext> => {
  const { contracts, signers } = await discover();

  return {
    contracts,
    signers,
    getSigner: async (signer: Signer, balance?: bigint) => getSigner(signer, balance, signers),
  };
};

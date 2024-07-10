import { LidoProtocol } from "../types";

export class PauseService {
  constructor(protected readonly protocol: LidoProtocol) {
  }

  /**
   * Unpauses the staking contract.
   */
  async unpauseStaking() {
    const { lido } = this.protocol.contracts;
    if (await lido.isStakingPaused()) {
      const votingSigner = await this.protocol.getSigner("voting");
      await lido.connect(votingSigner).resume();
    }
  }

  /**
   * Unpauses the withdrawal queue contract.
   */
  async unpauseWithdrawalQueue() {
    const { withdrawalQueue } = this.protocol.contracts;

    if (await withdrawalQueue.isPaused()) {
      const resumeRole = await withdrawalQueue.RESUME_ROLE();
      const agentSigner = await this.protocol.getSigner("agent");
      const agentSignerAddress = await agentSigner.getAddress();

      await withdrawalQueue.connect(agentSigner).grantRole(resumeRole, agentSignerAddress);
      await withdrawalQueue.connect(agentSigner).resume();
      await withdrawalQueue.connect(agentSigner).revokeRole(resumeRole, agentSignerAddress);
    }
  }
}

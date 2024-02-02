import { ContractTransactionReceipt, EventLog } from "ethers";

export function findEvents(receipt: ContractTransactionReceipt, eventName: string) {
  const events = [];

  for (const log of receipt.logs) {
    if (log instanceof EventLog && log.fragment.name === eventName) {
      events.push(log);
    }
  }

  return events;
}

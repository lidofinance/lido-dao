import { assert } from "chai";
import {
  ContractTransactionReceipt,
  EventLog,
  Interface,
  InterfaceAbi,
  LogDescription,
  TransactionReceipt,
} from "ethers";

import { Contract } from "lib/deploy";
import { log, yl } from "lib/log";

export function findEvents(receipt: ContractTransactionReceipt, eventName: string) {
  const events = [];

  for (const log of receipt.logs) {
    if (log instanceof EventLog && log.fragment.name === eventName) {
      events.push(log);
    }
  }

  return events;
}

export function findEventsWithAbi(receipt: TransactionReceipt, eventName: string, abi: InterfaceAbi): LogDescription[] {
  const iface = new Interface(abi);
  const foundEvents = [];

  for (const log of receipt.logs) {
    try {
      const event = iface.parseLog(log);
      if (event && event.name == eventName) {
        foundEvents.push(event);
      }
    } catch (error) {
      throw new Error(`Failed to find event ${eventName}, error: ${error}`);
    }
  }

  return foundEvents;
}

export async function assertLastEvent(instance: Contract, eventName: string, blockNumber: number) {
  // TODO
  const allEvents = await instance.getPastEvents("allEvents", { blockNumber });
  assert.isAbove(allEvents.length, 0, `${instance.name} generated at least one event`);

  const lastEvent = allEvents[allEvents.length - 1];
  const checkDesc = `the last event from ${instance.name} at ${instance.address} is ${yl(eventName)}`;
  assert.equal(lastEvent.event, eventName, checkDesc);
  log.success(checkDesc);

  return lastEvent;
}

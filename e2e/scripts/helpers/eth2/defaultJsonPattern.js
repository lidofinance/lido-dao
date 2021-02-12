export class DefaultJsonPattern {
  constructor(json) {
    this.jsonData = JSON.parse(json).data
  }

  getValidatorsPubKeys() {
    const pubKeys = []
    for (let i = 0; i < this.jsonData.length; i++) {
      pubKeys.push(this.jsonData[i].validator.pubkey)
    }
    return pubKeys
  }

  getValidatorBalance(pubKey) {
    for (let i = 0; i < this.jsonData.length; i++) {
      if (pubKey === this.jsonData[i].pubkey) {
        return this.jsonData[i].balance
      }
    }
  }

  getNetworkBlocksInfo() {
    return {
      slot: this.jsonData[0].data.slot,
      sourceEpoch: this.jsonData[0].data.source.epoch,
      targetEpoch: this.jsonData[0].data.target.epoch
    }
  }

  getGenesisTime() {
    return {
      genesisTime: this.jsonData.genesis_time
    }
  }

  getSpec() {
    return {
      slotsPerEpoch: this.jsonData.SLOTS_PER_EPOCH,
      secondsPerSlot: this.jsonData.SECONDS_PER_SLOT
    }
  }
}

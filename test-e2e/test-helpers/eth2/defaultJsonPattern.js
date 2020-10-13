export class DefaultJsonPattern {
  constructor(json) {
    this.jsonData = JSON.parse(json)
  }

  getValidatorsPubKeys() {
    const pubKeys = []
    for (let i = 0; i < this.jsonData.length; i++) {
      pubKeys.push(this.jsonData[i].pubkey)
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
}

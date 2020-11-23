export function getEndingBasedOnNumber(
  number,
  wordInSingular,
  wordInSpecialPlural
) {
  const numStr = number.toString()
  const lastIndex = numStr.length - 1
  const lastDigit = numStr[lastIndex]

  switch (lastDigit) {
    case '1':
      return wordInSingular
    default:
      return wordInSpecialPlural || wordInSingular + 's'
  }
}

export function formatKeys(keys) {
  return '0x' + keys.join('')
}

export function formatJsonData(jsonString) {
  const data = JSON.parse(jsonString)

  const quantity = data.length

  const pubkeysArray = data.map(({ pubkey }) => pubkey)
  const pubkeys = formatKeys(pubkeysArray)

  const signaturesArray = data.map(({ signature }) => signature)
  const signatures = formatKeys(signaturesArray)

  return { quantity, pubkeys, signatures }
}

export function isHexadecimal(hexString, length) {
  if (!length) return false

  const type = typeof hexString
  if (type !== 'string') return false

  const regex = new RegExp(`^[a-fA-F0-9]{${length}}$`)
  return regex.test(hexString)
}

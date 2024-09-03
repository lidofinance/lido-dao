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

export function hasDuplicatePubkeys(signingKeys) {
  const length = signingKeys.length
  const pubkeys = signingKeys.map((key) => key.pubkey)

  const pubkeySet = new Set(pubkeys)
  if (length !== pubkeySet.size) return true

  return false
}

export function hasDuplicateSigs(signingKeys) {
  const length = signingKeys.length

  const sigs = signingKeys.map((key) => key.signature)
  const sigSet = new Set(sigs)
  if (length !== sigSet.size) return true

  return false
}

export async function myFetch(url, method = 'GET', body) {
  const response = await fetch(url, {
    method,
    body: JSON.stringify(body),
    headers: {
      'Content-type': 'application/json',
    },
  })
  return response.json()
}

export const SIGNATURE_VERIFY_ENDPOINT = process.env.SIGNATURE_VERIFY_ENDPOINT

function withoutPrefix(hexString) {
  if (hexString.slice(0, 2) === '0x') {
    return hexString.slice(2)
  }
  return hexString
}

function shortenHex(hexString) {
  const hexNoPrefix = withoutPrefix(hexString)
  const len = hexNoPrefix.length
  const upTo = 4
  return `${hexNoPrefix.slice(0, upTo)}...${hexNoPrefix.slice(len - upTo)}`
}

export async function verifySignaturesAsync(signingKeys) {
  const body = signingKeys.map(({ pubkey, signature }) => ({
    pubkey,
    signature,
  }))

  const invalidSigs = await myFetch(SIGNATURE_VERIFY_ENDPOINT, 'POST', body)
  return invalidSigs.map(shortenHex)
}

export const SUBGRAPH_ENDPOINT = process.env.SUBGRAPH_ENDPOINT

function prefixEach(arrayOfkeys) {
  return arrayOfkeys.map(({ pubkey }) => '0x' + pubkey)
}

export async function checkForDuplicatesAsync(signingKeys) {
  const pubkeys = JSON.stringify(prefixEach(signingKeys))
  const response = await fetch(SUBGRAPH_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify({
      query: `
        query {
          nodeOperatorSigningKeys(
              where: {
                  pubkey_in: ${pubkeys}
              }
          ) {
            pubkey
          }
        }
      `,
    }),
    headers: {
      'Content-type': 'application/json',
    },
  })
  const { data } = await response.json()
  return data.nodeOperatorSigningKeys.map(({ pubkey }) => shortenHex(pubkey))
}

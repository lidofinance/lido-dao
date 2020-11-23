import BN from 'bn.js'

const TEN_TO_15 = new BN(10).pow(new BN(15))

/**
 * Formats wei value to Eth rounded to 3 decimal places.
 */
export function formatEth(wei) {
  return String(new BN(wei).div(TEN_TO_15) / 1000)
}

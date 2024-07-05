export const ZERO_HASH = new Uint8Array(32).fill(0);
export const ZERO_BYTES32 = "0x" + Buffer.from(ZERO_HASH).toString("hex");
export const ONE_DAY = 1n * 24n * 60n * 60n;
export const SHARE_RATE_PRECISION = 10n ** 27n;
export const EXTRA_DATA_FORMAT_EMPTY = 0n;
export const EXTRA_DATA_FORMAT_LIST = 1n;

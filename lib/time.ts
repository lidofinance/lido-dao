export function minutes(number: bigint): bigint {
  return number * 60n;
}

export function hours(number: bigint): bigint {
  return number * minutes(60n);
}

export function days(number: bigint): bigint {
  return number * hours(24n);
}

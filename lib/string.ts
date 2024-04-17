import { hexlify, randomBytes } from "ethers";

export function de0x(hex: string) {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

export function en0x(value: number | bigint) {
  const hexValue = value.toString(16);
  const prefix = hexValue.length % 2 ? "0x0" : "0x";
  return prefix + hexValue;
}

export function randomString(length: number) {
  return hexlify(randomBytes(length));
}

export function pad(hex: string, bytesLength: number, fill = "0") {
  const neededLength = bytesLength * 2 + 2 - hex.length;
  return neededLength > 0 ? `0x${fill.repeat(neededLength)}${hex.slice(2)}` : hex;
}

export function padRight(hex: string, length: number, fill = "0") {
  const strippedHex = hex.replace("0x", "");
  const neededLength = length * 2 - strippedHex.length;
  return neededLength > 0 ? `0x${strippedHex}${fill.repeat(neededLength)}` : hex;
}

export function hexConcat(...values: string[]) {
  const [first, ...rest] = values;
  let result = first.startsWith("0x") ? first : "0x" + first;
  rest.forEach((item) => {
    result += item.startsWith("0x") ? item.substr(2) : item;
  });
  return result;
}

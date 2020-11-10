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

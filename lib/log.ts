import chalk from "chalk";
import path from "path";

export type ConvertibleToString = string | number | boolean | { toString(): string };

export const rd = (s: ConvertibleToString) => chalk.red(s);
export const yl = (s: ConvertibleToString) => chalk.yellow(s);
export const gr = (s: ConvertibleToString) => chalk.green(s);
export const bl = (s: ConvertibleToString) => chalk.blue(s);
export const cy = (s: ConvertibleToString) => chalk.cyan(s);
export const mg = (s: ConvertibleToString) => chalk.magenta(s);

export const log = (...args: ConvertibleToString[]) => console.log(...args);

const INDENT = "    ";
const DEFAULT_PADDING = 8;

const MIN_LINE_LENGTH = 4;
const LINE_LENGTH = 20;
const LONG_LINE_LENGTH = 40;

export const OK = gr("[✓]");
export const NOT_OK = rd("[×]");

/**
 * Returns a string of the specified length, padded with spaces.
 */
const _pad = (size: number = DEFAULT_PADDING) => " ".repeat(size);

/**
 * Prints a line of the specified length, padded with "=" characters.
 * Example:
 *   line(20, 5)
 *    => '===================='
 */
const _line = (length = LINE_LENGTH, minLength = LINE_LENGTH): string => "=".repeat(Math.max(length, minLength));

/**
 * Prints a splitter with the specified length, padded with "=" characters.
 * Example:
 *   splitter(20, "Hello world!")
 *    => '===================='
 *       [ 'Hello world!' ]
 */
const _splitter = (minLength = LINE_LENGTH, ...args: ConvertibleToString[]) => {
  if (minLength < MIN_LINE_LENGTH) minLength = MIN_LINE_LENGTH;

  console.error(cy(_line(0, minLength)));

  if (args.length) {
    console.error(...args);
  }
};

/**
 * Prints a header with the specified message and arguments.
 * Example:
 *   header(20, "Hello world!", "Second optional argument")
 *      => '===================='
 *         '=   Hello world!   ='
 *         '===================='
 *         [ 'Second optional argument' ]
 */
const _header = (minLength = 20, ...args: ConvertibleToString[]) => {
  if (minLength < MIN_LINE_LENGTH) minLength = MIN_LINE_LENGTH;

  const title = args[0]?.toString().trim() ?? "";
  const totalLength = Math.max(title.length + 4, minLength);

  const line = _line(totalLength + 4, minLength);
  const paddedTitle = title.padStart((totalLength + title.length) / 2).padEnd(totalLength);

  console.error(`\n${cy(line)}`);
  console.error(`${cy("=")} ${mg(paddedTitle)} ${cy("=")}`);
  console.error(`${cy(line)}`);

  if (args.length > 1) {
    console.error(...args.slice(1).map((s) => s.toString()));
  }
};

const _title = (title: string, padding = DEFAULT_PADDING) => log(`${_pad(padding)}${mg(title)}`);

const _record = (label: string, value: ConvertibleToString, padding = DEFAULT_PADDING) =>
  log(`${_pad(padding)}${chalk.grey(label)}: ${yl(value.toString())}`);

// TODO: add logging to file

log.noEOL = (...args: ConvertibleToString[]) => process.stdout.write(args.toString() + " ");

log.success = (...args: ConvertibleToString[]) => console.log(OK, ...args);

log.error = (...args: ConvertibleToString[]) => console.error(NOT_OK, ...args);

log.splitter = (...args: ConvertibleToString[]) => _splitter(LINE_LENGTH, ...args);

log.wideSplitter = (...args: ConvertibleToString[]) => _splitter(LONG_LINE_LENGTH, ...args);

log.table = (...args: ConvertibleToString[]) => console.table(...args);

log.emptyLine = () => console.log();

log.header = (...args: ConvertibleToString[]) => _header(LINE_LENGTH, ...args);

log.withArguments = (firstLine: string, args: ConvertibleToString[]) => {
  log.noEOL(`${firstLine.trim()} (`);
  if (args.length > 0) {
    log.emptyLine();
  }
  for (const arg of args) {
    log(`${INDENT}${arg}`);
  }
  log(`)... `);
};

log.deployScriptStart = (filename: string) => {
  log.emptyLine();
  log.wideSplitter();
  log(`Started script ${bl(path.basename(filename))}`);
  log.wideSplitter();
};

log.deployScriptFinish = (filename: string) => {
  log(`Finished running script ${bl(path.basename(filename))}`);
};

log.infoBlock = (title: string, records: Record<string, ConvertibleToString>, padding = DEFAULT_PADDING) => {
  _title(title, padding);
  Object.keys(records).forEach((label) => _record(label, records[label], padding + 2));
};

log.warning = (title: string, padding = DEFAULT_PADDING): void => {
  console.log(`${_pad(padding)}${chalk.bold.yellow(title)}`);
};

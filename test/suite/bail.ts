export function bailOnFailure(this: Mocha.Context) {
  if (this.currentTest?.parent?.tests.some((t) => t.state === "failed")) {
    this.skip();
  }
}

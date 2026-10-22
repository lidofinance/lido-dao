import { expect } from "chai";

import { csm0x02SuiteEnabled } from "lib/protocol/helpers/csm0x02";
import { ProtocolContext } from "lib/protocol/types";

describe("CSM 0x02 integration availability", () => {
  let originalFlag: string | undefined;

  beforeEach(() => {
    originalFlag = process.env.INTEGRATION_WITH_CSM0x02;
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.INTEGRATION_WITH_CSM0x02;
    else process.env.INTEGRATION_WITH_CSM0x02 = originalFlag;
  });

  for (const isScratch of [false, true]) {
    for (const registered of [false, true]) {
      for (const flag of [undefined, "on", "off"]) {
        it(`scratch=${isScratch}, registered=${registered}, opt-in=${flag ?? "default"}`, () => {
          if (flag === undefined) delete process.env.INTEGRATION_WITH_CSM0x02;
          else process.env.INTEGRATION_WITH_CSM0x02 = flag;
          const ctx = {
            isScratch,
            modules: { all: registered ? [{ name: "Community Staking 0x02" }] : [] },
          } as unknown as ProtocolContext;

          const enabled = () => csm0x02SuiteEnabled(ctx, "the test suite");
          if (registered) expect(enabled()).to.equal(true);
          else if (!isScratch && flag === "off") expect(enabled()).to.equal(false);
          else expect(enabled).to.throw("CSM 0x02 is not registered in StakingRouter");
        });
      }
    }
  }
});

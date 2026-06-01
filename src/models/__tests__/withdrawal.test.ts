import { describe, expect, it } from "vitest";
import { sumWithdrawalClaimAmounts } from "../withdrawal";

describe("sumWithdrawalClaimAmounts", () => {
  it("adds proof amounts numerically even when the stored proof values are strings", () => {
    expect(
      sumWithdrawalClaimAmounts([
        { proof: { amount: "64" } as never },
        { proof: { amount: "32" } as never },
        { proof: { amount: "4" } as never },
      ]),
    ).toBe(100);
  });

  it("ignores non-positive and invalid amounts", () => {
    expect(
      sumWithdrawalClaimAmounts([
        { proof: { amount: "10" } as never },
        { proof: { amount: "0" } as never },
        { proof: { amount: -5 } as never },
        { proof: { amount: "oops" } as never },
      ]),
    ).toBe(10);
  });
});

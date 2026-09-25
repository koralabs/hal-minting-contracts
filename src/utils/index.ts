import type { BlockfrostTxClient } from "@koralabs/kora-labs-common/txBuild";

type RegistrationStatus = "registered" | "deregistered" | "none";

/** Registration state of the two HAL staking (withdrawal-validator) addresses. */
const checkAccountRegistrationStatus = async (
  blockfrost: Pick<BlockfrostTxClient, "getAccount">,
  mintStakingAddress: string,
  refSpendStakingAddress: string
): Promise<{
  mintStakingAddress: RegistrationStatus;
  refSpendStakingAddress: RegistrationStatus;
}> => {
  const status = async (stakeAddress: string): Promise<RegistrationStatus> => {
    const account = await blockfrost.getAccount(stakeAddress);
    if (!account) return "none";
    return account.active ? "registered" : "deregistered";
  };
  return {
    mintStakingAddress: await status(mintStakingAddress),
    refSpendStakingAddress: await status(refSpendStakingAddress),
  };
};

export { checkAccountRegistrationStatus };

export * from "./contract.js";
export * from "./math.js";

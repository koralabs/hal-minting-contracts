import { scriptStakeRegistration, stakeCredentialOf } from "../cardano/index.js";
import { HalTxPlan } from "./plan.js";

/**
 * Register the (script) staking addresses the HAL withdrawal validators run under. A script
 * credential's registration needs no witness; the wallet pays the key deposit and fee.
 */
const registerStakingAddresses = (bech32StakingAddresses: string[]): HalTxPlan => ({
  inputs: [],
  outputs: [],
  certificates: bech32StakingAddresses.map((address) =>
    scriptStakeRegistration(stakeCredentialOf(address).hash)
  ),
  plutusLanguages: [],
  referenceScriptBytes: 0,
});

export { registerStakingAddresses };

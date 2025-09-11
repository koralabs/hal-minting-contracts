import {
  makeAddress,
  makeMintingPolicyHash,
  makeRegistrationDCert,
  makeStakingAddress,
  makeStakingValidatorHash,
  makeValidatorHash,
} from "@helios-lang/ledger";

import {
  getMintingDataSpendUplcProgram,
  getMintProxyMintUplcProgram,
  getMintWithdrawUplcProgram,
  getOrdersSpendUplcProgram,
  getRefSpendProxyUplcProgram,
  getRefSpendUplcProgram,
  getRoyaltySpendUplcProgram,
} from "./validators.js";

interface BuildContractsParams {
  isMainnet: boolean;
  mint_version: bigint;
  admin_verification_key_hash: string;
  orders_spend_randomizer?: string | undefined;
  royalty_spend_admin: string;
}

/**
 * @description Build Contracts for De-Mi from config
 * @param {BuildContractsParams} params
 * @returns All Contracts
 */
const buildContracts = (params: BuildContractsParams) => {
  const {
    isMainnet,
    mint_version,
    admin_verification_key_hash,
    orders_spend_randomizer = "",
    royalty_spend_admin,
  } = params;

  // "mint_proxy.mint"
  const mintProxyMintUplcProgram = getMintProxyMintUplcProgram(mint_version);
  const mintProxyPolicyHash = makeMintingPolicyHash(
    mintProxyMintUplcProgram.hash()
  );
  const halPolicyHash = mintProxyPolicyHash;

  // "mint.withdraw"
  const mintWithdrawUplcProgram = getMintWithdrawUplcProgram();
  const mintValidatorHash = makeValidatorHash(mintWithdrawUplcProgram.hash());
  const mintStakingAddress = makeStakingAddress(
    isMainnet,
    makeStakingValidatorHash(mintWithdrawUplcProgram.hash())
  );
  const mintRegistrationDCert = makeRegistrationDCert(
    mintStakingAddress.stakingCredential
  );

  // "minting_data.spend"
  const mintingDataSpendUplcProgram = getMintingDataSpendUplcProgram(
    admin_verification_key_hash
  );
  const mintingDataValidatorHash = makeValidatorHash(
    mintingDataSpendUplcProgram.hash()
  );
  const mintingDataValidatorAddress = makeAddress(
    isMainnet,
    mintingDataValidatorHash
  );

  // "orders_spend.spend"
  const ordersSpendUplcProgram = getOrdersSpendUplcProgram(
    halPolicyHash.toHex(),
    orders_spend_randomizer
  );
  const ordersSpendValidatorHash = makeValidatorHash(
    ordersSpendUplcProgram.hash()
  );
  const ordersSpendValidatorAddress = makeAddress(
    isMainnet,
    ordersSpendValidatorHash
  );

  // "ref_spend_proxy.spend"
  const refSpendProxyUplcProgram = getRefSpendProxyUplcProgram();
  const refSpendProxyValidatorHash = makeValidatorHash(
    refSpendProxyUplcProgram.hash()
  );
  const refSpendProxyValidatorAddress = makeAddress(
    isMainnet,
    refSpendProxyValidatorHash
  );

  // "ref_spend.withdrawe"
  const refSpendUplcProgram = getRefSpendUplcProgram();
  const refSpendValidatorHash = makeValidatorHash(refSpendUplcProgram.hash());
  const refSpendStakingAddress = makeStakingAddress(
    isMainnet,
    makeStakingValidatorHash(refSpendUplcProgram.hash())
  );
  const refSpendRegistrationDCert = makeRegistrationDCert(
    refSpendStakingAddress.stakingCredential
  );

  // "royalty_spend.spend"
  const royaltySpendUplcProgram =
    getRoyaltySpendUplcProgram(royalty_spend_admin);
  const royaltySpendValidatorHash = makeValidatorHash(
    royaltySpendUplcProgram.hash()
  );
  const royaltySpendValidatorAddress = makeAddress(
    isMainnet,
    royaltySpendValidatorHash
  );

  return {
    halPolicyHash,
    mintProxy: {
      mintProxyMintUplcProgram,
      mintProxyPolicyHash,
    },
    mint: {
      mintWithdrawUplcProgram,
      mintValidatorHash,
      mintStakingAddress,
      mintRegistrationDCert,
    },
    mintingData: {
      mintingDataSpendUplcProgram,
      mintingDataValidatorHash,
      mintingDataValidatorAddress,
    },
    ordersSpend: {
      ordersSpendUplcProgram,
      ordersSpendValidatorHash,
      ordersSpendValidatorAddress,
    },
    refSpendProxy: {
      refSpendProxyUplcProgram,
      refSpendProxyValidatorHash,
      refSpendProxyValidatorAddress,
    },
    refSpend: {
      refSpendUplcProgram,
      refSpendValidatorHash,
      refSpendStakingAddress,
      refSpendRegistrationDCert,
    },
    royaltySpend: {
      royaltySpendUplcProgram,
      royaltySpendValidatorHash,
      royaltySpendValidatorAddress,
    },
  };
};

export type { BuildContractsParams };
export { buildContracts };

import {
  makeAddress,
  makeMintingPolicyHash,
  makeRegistrationDCert,
  makeStakingAddress,
  makeStakingValidatorHash,
  makeValidatorHash,
} from "@helios-lang/ledger";
import { NetworkName } from "@helios-lang/tx-utils";

import {
  getMintingDataSpendUplcProgram,
  getMintProxyMintUplcProgram,
  getMintV1WithdrawUplcProgram,
  getOrdersMintUplcProgram,
  getOrdersSpendUplcProgram,
  getRefSpendUplcProgram,
} from "./validators.js";

/**
 * @interface
 * @typedef {object} BuildContractsParams
 * @property {NetworkName} network Cardano Network
 * @property {bigint} mint_version HAL NFT version
 * @property {string} admin_verification_key_hash Admin Verification Key Hash
 */
interface BuildContractsParams {
  network: NetworkName;
  mint_version: bigint;
  admin_verification_key_hash: string;
}

/**
 * @description Build Contracts for De-Mi from config
 * @param {BuildContractsParams} params
 * @returns All Contracts
 */
const buildContracts = (params: BuildContractsParams) => {
  const { network, mint_version, admin_verification_key_hash } = params;
  const isMainnet = network == "mainnet";

  // "mint_proxy.mint"
  const mintProxyMintUplcProgram = getMintProxyMintUplcProgram(mint_version);
  const mintProxyPolicyHash = makeMintingPolicyHash(
    mintProxyMintUplcProgram.hash()
  );
  const halPolicyHash = mintProxyPolicyHash;

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

  // "mint_v1.withdraw"
  const mintV1WithdrawUplcProgram = getMintV1WithdrawUplcProgram(
    mintingDataValidatorHash.toHex()
  );
  const mintV1ValidatorHash = makeValidatorHash(
    mintV1WithdrawUplcProgram.hash()
  );
  const mintV1StakingAddress = makeStakingAddress(
    isMainnet,
    makeStakingValidatorHash(mintV1WithdrawUplcProgram.hash())
  );
  const mintV1RegistrationDCert = makeRegistrationDCert(
    mintV1StakingAddress.stakingCredential
  );

  // "orders_mint.mint"
  const ordersMintUplcProgram = getOrdersMintUplcProgram();
  const ordersMintValidatorHash = makeValidatorHash(
    ordersMintUplcProgram.hash()
  );
  const ordersMintPolicyHash = makeMintingPolicyHash(ordersMintValidatorHash);

  // "orders.spend"
  const ordersSpendUplcProgram = getOrdersSpendUplcProgram(
    halPolicyHash.toHex(),
    ordersMintPolicyHash.toHex()
  );
  const ordersValidatorHash = makeValidatorHash(ordersSpendUplcProgram.hash());
  const ordersSpendValidatorAddress = makeAddress(
    isMainnet,
    ordersValidatorHash
  );

  // "ref_spend.spend"
  const refSpendUplcProgram = getRefSpendUplcProgram();
  const refSpendValidatorHash = makeValidatorHash(refSpendUplcProgram.hash());
  const refSpendValidatorAddress = makeAddress(
    isMainnet,
    refSpendValidatorHash
  );

  return {
    halPolicyHash,
    mintProxy: {
      mintProxyMintUplcProgram,
      mintProxyPolicyHash,
    },
    mintingData: {
      mintingDataSpendUplcProgram,
      mintingDataValidatorHash,
      mintingDataValidatorAddress,
    },
    mintV1: {
      mintV1WithdrawUplcProgram,
      mintV1ValidatorHash,
      mintV1StakingAddress,
      mintV1RegistrationDCert,
    },
    ordersMint: {
      ordersMintUplcProgram,
      ordersMintValidatorHash,
      ordersMintPolicyHash,
    },
    ordersSpend: {
      ordersSpendUplcProgram,
      ordersValidatorHash,
      ordersSpendValidatorAddress,
    },
    refSpend: {
      refSpendUplcProgram,
      refSpendValidatorHash,
      refSpendValidatorAddress,
    },
  };
};

export type { BuildContractsParams };
export { buildContracts };

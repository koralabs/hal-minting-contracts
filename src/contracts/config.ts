import {
  Cardano,
  scriptAddress,
  scriptRewardAccount,
  scriptStakeRegistration,
} from "../cardano/index.js";
import {
  getMintingDataSpendScript,
  getMintProxyMintScript,
  getMintWithdrawScript,
  getOrdersSpendScript,
  getRefSpendProxyScript,
  getRefSpendScript,
  getRoyaltySpendScript,
  PlutusV2Script,
} from "./validators.js";

interface BuildContractsParams {
  isMainnet: boolean;
  mint_version: bigint;
  admin_verification_key_hash: string;
  orders_spend_randomizer?: string | undefined;
  royalty_spend_admin: string;
}

/** Every HAL contract: its applied script, hash (hex) and address (bech32). */
interface BuiltContracts {
  halPolicyHash: string;
  mintProxy: { mintProxyMintScript: PlutusV2Script; mintProxyPolicyHash: string };
  mint: {
    mintWithdrawScript: PlutusV2Script;
    mintValidatorHash: string;
    mintStakingAddress: Cardano.RewardAccount;
    mintRegistrationDCert: Cardano.Certificate;
  };
  mintingData: {
    mintingDataSpendScript: PlutusV2Script;
    mintingDataValidatorHash: string;
    mintingDataValidatorAddress: string;
  };
  ordersSpend: {
    ordersSpendScript: PlutusV2Script;
    ordersSpendValidatorHash: string;
    ordersSpendValidatorAddress: string;
  };
  refSpendProxy: {
    refSpendProxyScript: PlutusV2Script;
    refSpendProxyValidatorHash: string;
    refSpendProxyValidatorAddress: string;
  };
  refSpend: {
    refSpendScript: PlutusV2Script;
    refSpendValidatorHash: string;
    refSpendStakingAddress: Cardano.RewardAccount;
    refSpendRegistrationDCert: Cardano.Certificate;
  };
  royaltySpend: {
    royaltySpendScript: PlutusV2Script;
    royaltySpendValidatorHash: string;
    royaltySpendValidatorAddress: string;
  };
}

/**
 * @description Build the HAL contracts from config. Hashes are hex; addresses are bech32.
 */
const buildContracts = (params: BuildContractsParams): BuiltContracts => {
  const {
    isMainnet,
    mint_version,
    admin_verification_key_hash,
    orders_spend_randomizer = "",
    royalty_spend_admin,
  } = params;

  // "halmntprx.mint"
  const mintProxyMintScript = getMintProxyMintScript(mint_version);
  const halPolicyHash = mintProxyMintScript.hash;

  // "halmnt.withdraw"
  const mintWithdrawScript = getMintWithdrawScript();

  // "halmntmpt.spend"
  const mintingDataSpendScript = getMintingDataSpendScript(admin_verification_key_hash);

  // "halord.spend"
  const ordersSpendScript = getOrdersSpendScript(halPolicyHash, orders_spend_randomizer);

  // "halrefprx.spend"
  const refSpendProxyScript = getRefSpendProxyScript();

  // "halref.withdraw"
  const refSpendScript = getRefSpendScript();

  // "halroy.spend"
  const royaltySpendScript = getRoyaltySpendScript(royalty_spend_admin);

  return {
    halPolicyHash,
    mintProxy: {
      mintProxyMintScript,
      mintProxyPolicyHash: halPolicyHash,
    },
    mint: {
      mintWithdrawScript,
      mintValidatorHash: mintWithdrawScript.hash,
      mintStakingAddress: scriptRewardAccount(mintWithdrawScript.hash, isMainnet),
      mintRegistrationDCert: scriptStakeRegistration(mintWithdrawScript.hash),
    },
    mintingData: {
      mintingDataSpendScript,
      mintingDataValidatorHash: mintingDataSpendScript.hash,
      mintingDataValidatorAddress: scriptAddress(mintingDataSpendScript.hash, isMainnet),
    },
    ordersSpend: {
      ordersSpendScript,
      ordersSpendValidatorHash: ordersSpendScript.hash,
      ordersSpendValidatorAddress: scriptAddress(ordersSpendScript.hash, isMainnet),
    },
    refSpendProxy: {
      refSpendProxyScript,
      refSpendProxyValidatorHash: refSpendProxyScript.hash,
      refSpendProxyValidatorAddress: scriptAddress(refSpendProxyScript.hash, isMainnet),
    },
    refSpend: {
      refSpendScript,
      refSpendValidatorHash: refSpendScript.hash,
      refSpendStakingAddress: scriptRewardAccount(refSpendScript.hash, isMainnet),
      refSpendRegistrationDCert: scriptStakeRegistration(refSpendScript.hash),
    },
    royaltySpend: {
      royaltySpendScript,
      royaltySpendValidatorHash: royaltySpendScript.hash,
      royaltySpendValidatorAddress: scriptAddress(royaltySpendScript.hash, isMainnet),
    },
  };
};

export type { BuildContractsParams, BuiltContracts };
export { buildContracts };

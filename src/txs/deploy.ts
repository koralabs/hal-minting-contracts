import { bytesToHex } from "@helios-lang/codec-utils";
import { makeTxOutputId, TxInput } from "@helios-lang/ledger";
import { BlockfrostV0Client } from "@helios-lang/tx-utils";
import { decodeUplcProgramV2FromCbor, UplcProgramV2 } from "@helios-lang/uplc";
import { ScriptDetails, ScriptType } from "@koralabs/kora-labs-common";
import { Err, Ok, Result } from "ts-res";

import { CONTRACT_NAME } from "../constants/index.js";
import {
  buildContracts,
  makeMintingDataUplcProgramParameterDatum,
  makeMintProxyUplcProgramParameterDatum,
  makeOrdersSpendUplcProgramParameterDatum,
  makeRoyaltySpendUplcProgramParameterDatum,
} from "../contracts/index.js";
import { convertError, invariant } from "../helpers/index.js";
import { fetchDeployedScript } from "../utils/contract.js";

interface DeployParams {
  isMainnet: boolean;
  mintVersion: bigint;
  adminVerificationKeyHash: string;
  ordersSpendRandomizer?: string | undefined;
  royaltySpendAdmin: string;
  contractName: string;
}

interface DeployData {
  optimizedCbor: string;
  unOptimizedCbor?: string;
  datumCbor?: string;
  validatorHash: string;
  policyId?: string;
  scriptAddress?: string;
  scriptStakingAddress?: string;
}

/**
 * @description Deploy one of De-Mi contracts
 * @param {DeployParams} params
 * @returns {Promise<DeployData>} Deploy Data
 */
const deploy = async (params: DeployParams): Promise<DeployData> => {
  const {
    isMainnet,
    mintVersion,
    adminVerificationKeyHash,
    ordersSpendRandomizer = "",
    royaltySpendAdmin,
    contractName,
  } = params;

  const contractsConfig = buildContracts({
    isMainnet,
    mint_version: mintVersion,
    admin_verification_key_hash: adminVerificationKeyHash,
    orders_spend_randomizer: ordersSpendRandomizer,
    royalty_spend_admin: royaltySpendAdmin,
  });
  const {
    halPolicyHash,
    mintProxy: mintProxyConfig,
    mint: mintConfig,
    mintingData: mintingDataConfig,
    ordersSpend: ordersSpendConfig,
    refSpendProxy: refSpendProxyConfig,
    refSpend: refSpendConfig,
    royaltySpend: royaltySpendConfig,
  } = contractsConfig;

  switch (contractName) {
    case CONTRACT_NAME.MINT_PROXY_MINT:
      return {
        ...extractScriptCborsFromUplcProgram(
          mintProxyConfig.mintProxyMintUplcProgram
        ),
        datumCbor: bytesToHex(
          makeMintProxyUplcProgramParameterDatum(mintVersion).data.toCbor()
        ),
        validatorHash: mintProxyConfig.mintProxyPolicyHash.toHex(),
        policyId: mintProxyConfig.mintProxyPolicyHash.toHex(),
      };
    case CONTRACT_NAME.MINT_WITHDRAW:
      return {
        ...extractScriptCborsFromUplcProgram(
          mintConfig.mintWithdrawUplcProgram
        ),
        validatorHash: mintConfig.mintValidatorHash.toHex(),
        scriptStakingAddress: mintConfig.mintStakingAddress.toBech32(),
      };
    case CONTRACT_NAME.MINTING_DATA_SPEND:
      return {
        ...extractScriptCborsFromUplcProgram(
          mintingDataConfig.mintingDataSpendUplcProgram
        ),
        datumCbor: bytesToHex(
          makeMintingDataUplcProgramParameterDatum(
            adminVerificationKeyHash
          ).data.toCbor()
        ),
        validatorHash: mintingDataConfig.mintingDataValidatorHash.toHex(),
        scriptAddress: mintingDataConfig.mintingDataValidatorAddress.toBech32(),
      };
    case CONTRACT_NAME.ORDERS_SPEND_SPEND:
      return {
        ...extractScriptCborsFromUplcProgram(
          ordersSpendConfig.ordersSpendUplcProgram
        ),
        datumCbor: bytesToHex(
          makeOrdersSpendUplcProgramParameterDatum(
            halPolicyHash.toHex(),
            ordersSpendRandomizer
          ).data.toCbor()
        ),
        validatorHash: ordersSpendConfig.ordersSpendValidatorHash.toHex(),
        scriptAddress: ordersSpendConfig.ordersSpendValidatorAddress.toBech32(),
      };
    case CONTRACT_NAME.REF_SPEND_PROXY_SPEND:
      return {
        ...extractScriptCborsFromUplcProgram(
          refSpendProxyConfig.refSpendProxyUplcProgram
        ),
        validatorHash: refSpendProxyConfig.refSpendProxyValidatorHash.toHex(),
        scriptAddress:
          refSpendProxyConfig.refSpendProxyValidatorAddress.toBech32(),
      };
    case CONTRACT_NAME.REF_SPEND_WITHDRAW:
      return {
        ...extractScriptCborsFromUplcProgram(
          refSpendConfig.refSpendUplcProgram
        ),
        validatorHash: refSpendConfig.refSpendValidatorHash.toHex(),
        scriptStakingAddress: refSpendConfig.refSpendStakingAddress.toBech32(),
      };
    case CONTRACT_NAME.ROYALTY_SPEND_SPEND:
      return {
        ...extractScriptCborsFromUplcProgram(
          royaltySpendConfig.royaltySpendUplcProgram
        ),
        datumCbor: bytesToHex(
          makeRoyaltySpendUplcProgramParameterDatum(
            royaltySpendAdmin
          ).data.toCbor()
        ),
        validatorHash: royaltySpendConfig.royaltySpendValidatorHash.toHex(),
        scriptAddress:
          royaltySpendConfig.royaltySpendValidatorAddress.toBech32(),
      };
    default:
      throw new Error(
        `Contract name must be one of ${Object.values(CONTRACT_NAME).join(
          ", "
        )}`
      );
  }
};

const extractScriptCborsFromUplcProgram = (
  uplcProgram: UplcProgramV2
): { optimizedCbor: string; upOptimizedCbor?: string } => {
  return {
    optimizedCbor: bytesToHex(uplcProgram.toCbor()),
    upOptimizedCbor: uplcProgram.alt
      ? bytesToHex(uplcProgram.alt.toCbor())
      : undefined,
  };
};

interface DeployedScripts {
  mintProxyScriptDetails: ScriptDetails;
  mintProxyScriptTxInput: TxInput;
  mintingDataScriptDetails: ScriptDetails;
  mintingDataScriptTxInput: TxInput;
  mintScriptDetails: ScriptDetails;
  mintScriptTxInput: TxInput;
  ordersSpendScriptDetails: ScriptDetails;
  ordersSpendScriptTxInput: TxInput;
  refSpendProxyScriptDetails: ScriptDetails;
  refSpendProxyScriptTxInput: TxInput;
  refSpendScriptDetails: ScriptDetails;
  refSpendScriptTxInput: TxInput;
  royaltySpendScriptDetails: ScriptDetails;
  royaltySpendScriptTxInput: TxInput;
}

const fetchAllDeployedScripts = async (
  blockfrostV0Client: BlockfrostV0Client
): Promise<Result<DeployedScripts, string>> => {
  try {
    // "mint_proxy.mint"
    const mintProxyScriptDetails = await fetchDeployedScript(
      ScriptType.HAL_MINT_PROXY
    );
    invariant(
      mintProxyScriptDetails.refScriptUtxo,
      "Mint Proxy has no Ref script UTxO"
    );
    const mintProxyScriptTxInput = await blockfrostV0Client.getUtxo(
      makeTxOutputId(mintProxyScriptDetails.refScriptUtxo)
    );
    if (mintProxyScriptDetails.unoptimizedCbor)
      mintProxyScriptTxInput.output.refScript = (
        mintProxyScriptTxInput.output.refScript as UplcProgramV2
      )?.withAlt(
        decodeUplcProgramV2FromCbor(mintProxyScriptDetails.unoptimizedCbor)
      );

    // "mint.withdraw"
    const mintScriptDetails = await fetchDeployedScript(ScriptType.HAL_MINT);
    invariant(mintScriptDetails.refScriptUtxo, "Mint has no Ref script UTxO");
    const mintScriptTxInput = await blockfrostV0Client.getUtxo(
      makeTxOutputId(mintScriptDetails.refScriptUtxo)
    );
    if (mintScriptDetails.unoptimizedCbor)
      mintScriptTxInput.output.refScript = (
        mintScriptTxInput.output.refScript as UplcProgramV2
      )?.withAlt(
        decodeUplcProgramV2FromCbor(mintScriptDetails.unoptimizedCbor)
      );

    // "minting_data.spend"
    const mintingDataScriptDetails = await fetchDeployedScript(
      ScriptType.HAL_MINTING_DATA
    );
    invariant(
      mintingDataScriptDetails.refScriptUtxo,
      "Minting Data has no Ref script UTxO"
    );
    const mintingDataScriptTxInput = await blockfrostV0Client.getUtxo(
      makeTxOutputId(mintingDataScriptDetails.refScriptUtxo)
    );
    if (mintingDataScriptDetails.unoptimizedCbor)
      mintingDataScriptTxInput.output.refScript = (
        mintingDataScriptTxInput.output.refScript as UplcProgramV2
      )?.withAlt(
        decodeUplcProgramV2FromCbor(mintingDataScriptDetails.unoptimizedCbor)
      );

    // "orders_spend.spend"
    const ordersSpendScriptDetails = await fetchDeployedScript(
      ScriptType.HAL_ORDERS_SPEND
    );
    invariant(
      ordersSpendScriptDetails.refScriptUtxo,
      "Orders Spend has no Ref script UTxO"
    );
    const ordersSpendScriptTxInput = await blockfrostV0Client.getUtxo(
      makeTxOutputId(ordersSpendScriptDetails.refScriptUtxo)
    );
    if (ordersSpendScriptDetails.unoptimizedCbor)
      ordersSpendScriptTxInput.output.refScript = (
        ordersSpendScriptTxInput.output.refScript as UplcProgramV2
      )?.withAlt(
        decodeUplcProgramV2FromCbor(ordersSpendScriptDetails.unoptimizedCbor)
      );

    // "ref_spend_proxy.spend"
    const refSpendProxyScriptDetails = await fetchDeployedScript(
      ScriptType.HAL_REF_SPEND_PROXY
    );
    invariant(
      refSpendProxyScriptDetails.refScriptUtxo,
      "Ref Spend Proxy has no Ref script UTxO"
    );
    const refSpendProxyScriptTxInput = await blockfrostV0Client.getUtxo(
      makeTxOutputId(refSpendProxyScriptDetails.refScriptUtxo)
    );
    if (refSpendProxyScriptDetails.unoptimizedCbor)
      refSpendProxyScriptTxInput.output.refScript = (
        refSpendProxyScriptTxInput.output.refScript as UplcProgramV2
      )?.withAlt(
        decodeUplcProgramV2FromCbor(refSpendProxyScriptDetails.unoptimizedCbor)
      );

    // "ref_spend.withdraw"
    const refSpendScriptDetails = await fetchDeployedScript(
      ScriptType.HAL_REF_SPEND
    );
    invariant(
      refSpendScriptDetails.refScriptUtxo,
      "Ref Spend has no Ref script UTxO"
    );
    const refSpendScriptTxInput = await blockfrostV0Client.getUtxo(
      makeTxOutputId(refSpendScriptDetails.refScriptUtxo)
    );
    if (refSpendScriptDetails.unoptimizedCbor)
      refSpendScriptTxInput.output.refScript = (
        refSpendScriptTxInput.output.refScript as UplcProgramV2
      )?.withAlt(
        decodeUplcProgramV2FromCbor(refSpendScriptDetails.unoptimizedCbor)
      );

    // "royalty_spend.spend"
    const royaltySpendScriptDetails = await fetchDeployedScript(
      ScriptType.HAL_ROYALTY_SPEND
    );
    invariant(
      royaltySpendScriptDetails.refScriptUtxo,
      "Royalty Spend has no Ref script UTxO"
    );
    const royaltySpendScriptTxInput = await blockfrostV0Client.getUtxo(
      makeTxOutputId(royaltySpendScriptDetails.refScriptUtxo)
    );
    if (royaltySpendScriptDetails.unoptimizedCbor)
      royaltySpendScriptTxInput.output.refScript = (
        royaltySpendScriptTxInput.output.refScript as UplcProgramV2
      )?.withAlt(
        decodeUplcProgramV2FromCbor(royaltySpendScriptDetails.unoptimizedCbor)
      );

    return Ok({
      mintProxyScriptDetails,
      mintProxyScriptTxInput,
      mintingDataScriptDetails,
      mintingDataScriptTxInput,
      mintScriptDetails,
      mintScriptTxInput,
      ordersSpendScriptDetails,
      ordersSpendScriptTxInput,
      refSpendProxyScriptDetails,
      refSpendProxyScriptTxInput,
      refSpendScriptDetails,
      refSpendScriptTxInput,
      royaltySpendScriptDetails,
      royaltySpendScriptTxInput,
    });
  } catch (err) {
    return Err(convertError(err));
  }
};

export type { DeployData, DeployedScripts, DeployParams };
export { deploy, fetchAllDeployedScripts };

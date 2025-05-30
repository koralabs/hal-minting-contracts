import { Trie } from "@aiken-lang/merkle-patricia-forestry";
import { BlockFrostAPI } from "@blockfrost/blockfrost-js";
import { bytesToHex } from "@helios-lang/codec-utils";
import { makeAddress } from "@helios-lang/ledger";
import { NetworkName } from "@helios-lang/tx-utils";
import fs from "fs/promises";
import prompts from "prompts";

import {
  BLOCKFROST_API_KEY,
  CONTRACT_NAMES,
  NETWORK,
} from "../../src/constants/index.js";
import {
  buildContracts,
  buildMintingData,
  buildSettingsData,
  buildSettingsV1Data,
  checkAccountRegistrationStatus,
  deploy,
  getBlockfrostV0Client,
  MintingData,
  registerStakingAddress,
  Settings,
  SettingsV1,
} from "../../src/index.js";
import { GET_CONFIGS } from "../configs/index.js";
import { CommandImpl } from "./types.js";

const doOnChainActions = async (commandImpl: CommandImpl) => {
  let finished: boolean = false;
  while (!finished) {
    const onChainAction = await prompts({
      message: "Pick an action",
      type: "select",
      name: "action",
      choices: [
        {
          title: "deploy",
          description: "Deploy De-Mi Contracts",
          value: async () => {
            await doDeployActions();
          },
        },
        {
          title: "settings",
          description: "Build Settings Datum CBOR",
          value: async () => {
            const settingsCbor = buildSettingsDataCbor();
            console.log("\n\n------- Settings CBOR -------\n");
            console.log(settingsCbor);
            console.log("\n");
          },
        },
        {
          title: "minting-data",
          description: "Build Minting Data Datum CBOR",
          value: async () => {
            const mintingDataCbor = buildMintingDataCbor(commandImpl.mpt!);
            console.log(
              "\n\n------- Lock This Minting Data CBOR with asset -------\n"
            );
            console.log(mintingDataCbor.cbor);
            console.log("\n");
            console.log("\n------- To This address -------\n");
            console.log(mintingDataCbor.lockAddress.toString());
            console.log("\n");
          },
          disabled: !commandImpl.mpt,
        },
        {
          title: "staking-addresses",
          description: "Staking Addresses to Register",
          value: async () => {
            const { address } = await prompts([
              {
                name: "address",
                type: "text",
                message: "Address to pay registration fee",
              },
            ]);
            const stakingAddresses = getStakingAddresses();
            const blockfrostApi = new BlockFrostAPI({
              projectId: BLOCKFROST_API_KEY,
            });
            const blockfrostV0Client =
              getBlockfrostV0Client(BLOCKFROST_API_KEY);

            // check if staking address is registered or not
            const status = await checkAccountRegistrationStatus(
              blockfrostApi,
              stakingAddresses.mintV1StakingAddress
            );
            console.log("\n\n------- Staking Addresses To Register -------\n");
            console.log(stakingAddresses);
            console.log("\n");
            if (status != "registered") {
              console.log("Staking address is not registered");
              console.log(
                "Please register the staking address using Script CBOR, just a sec..."
              );
              const txCbor = await registerStakingAddress(
                NETWORK as NetworkName,
                makeAddress(address),
                await blockfrostV0Client.getUtxos(address),
                stakingAddresses.mintV1StakingAddress
              );
              await handleTxCbor(txCbor);
            } else {
              console.log("\nStaking Address is already registered\n");
            }
          },
          disabled: !commandImpl.mpt,
        },
        {
          title: "back",
          description: "Back to main actions",
          value: () => {
            finished = true;
          },
        },
      ],
    });
    await onChainAction.action();
  }
};

const buildSettingsDataCbor = () => {
  const configs = GET_CONFIGS(NETWORK as NetworkName);
  const {
    MINT_VERSION,
    ADMIN_VERIFICATION_KEY_HASH,
    ALLOWED_MINTER,
    HAL_NFT_PRICE,
    PAYMENT_ADDRESS,
    ORDERS_MINTER,
    REF_SPEND_ADMIN,
    MAX_ORDER_AMOUNT,
  } = configs;

  const contractsConfig = buildContracts({
    network: NETWORK as NetworkName,
    mint_version: MINT_VERSION,
    admin_verification_key_hash: ADMIN_VERIFICATION_KEY_HASH,
  });
  const {
    halPolicyHash,
    mintV1: mintV1Config,
    mintingData: mintingDataConfig,
    ordersMint: ordersMintConfig,
    ordersSpend: ordersSpendConfig,
    refSpend: refSpendConfig,
  } = contractsConfig;

  // we already have settings asset using legacy handle.
  const settingsV1: SettingsV1 = {
    policy_id: halPolicyHash.toHex(),
    allowed_minter: ALLOWED_MINTER,
    hal_nft_price: HAL_NFT_PRICE,
    payment_address: PAYMENT_ADDRESS,
    ref_spend_script_address: refSpendConfig.refSpendValidatorAddress,
    orders_spend_script_address: ordersSpendConfig.ordersSpendValidatorAddress,
    orders_mint_policy_id: ordersMintConfig.ordersMintPolicyHash.toHex(),
    minting_data_script_hash:
      mintingDataConfig.mintingDataValidatorHash.toHex(),
    orders_minter: ORDERS_MINTER,
    ref_spend_admin: REF_SPEND_ADMIN,
    max_order_amount: MAX_ORDER_AMOUNT,
  };
  const settings: Settings = {
    mint_governor: mintV1Config.mintV1ValidatorHash.toHex(),
    mint_version: MINT_VERSION,
    data: buildSettingsV1Data(settingsV1),
  };

  return bytesToHex(buildSettingsData(settings).toCbor());
};

const buildMintingDataCbor = (db: Trie) => {
  const configs = GET_CONFIGS(NETWORK as NetworkName);
  const { MINT_VERSION, ADMIN_VERIFICATION_KEY_HASH } = configs;

  const contractsConfig = buildContracts({
    network: NETWORK as NetworkName,
    mint_version: MINT_VERSION,
    admin_verification_key_hash: ADMIN_VERIFICATION_KEY_HASH,
  });
  const { mintingData: mintingDataConfig } = contractsConfig;

  // we already have settings asset using legacy handle.
  const mintingData: MintingData = {
    mpt_root_hash: db.hash.toString("hex"),
  };

  return {
    cbor: bytesToHex(buildMintingData(mintingData).toCbor()),
    lockAddress: mintingDataConfig.mintingDataValidatorAddress,
  };
};

const getStakingAddresses = () => {
  const configs = GET_CONFIGS(NETWORK as NetworkName);
  const { MINT_VERSION, ADMIN_VERIFICATION_KEY_HASH } = configs;

  const contractsConfig = buildContracts({
    network: NETWORK as NetworkName,
    mint_version: MINT_VERSION,
    admin_verification_key_hash: ADMIN_VERIFICATION_KEY_HASH,
  });
  const { mintV1: mintV1Config } = contractsConfig;

  return {
    mintV1StakingAddress: mintV1Config.mintV1StakingAddress.toBech32(),
  };
};

const doDeployActions = async () => {
  const configs = GET_CONFIGS(NETWORK as NetworkName);
  const { MINT_VERSION, ADMIN_VERIFICATION_KEY_HASH } = configs;

  let finished: boolean = false;
  while (!finished) {
    const deployAction = await prompts({
      message: "Select Contract to Deploy",
      type: "select",
      name: "action",
      choices: [
        ...CONTRACT_NAMES.map((contract) => ({
          title: contract,
          description: contract,
          value: async () => {
            const deployData = await deploy({
              network: NETWORK as NetworkName,
              mintVersion: MINT_VERSION,
              adminVerificationKeyHash: ADMIN_VERIFICATION_KEY_HASH,
              contractName: contract,
            });

            const { filepath } = await prompts({
              name: "filepath",
              type: "text",
              message: "File Path to save data",
            });
            await fs.writeFile(filepath, JSON.stringify(deployData));

            if (contract === "mint_proxy.mint") {
              console.log(
                "\n\n------- Be careful with Mint Proxy Mint Script -------\n"
              );
              console.log("!!! THIS WILL CHANGE POLICY ID !!!");
              console.log("\n");
            } else if (contract === "mint_v1.withdraw") {
              console.log(
                "\n\n------- After Deploying Mint V1 Withdraw Script -------\n"
              );
              console.log("!!! UPDATE SETTINGS DATUM !!!");
              console.log("\n");
              console.log("!!! Register Staking Addresses !!!");
              console.log("\n");
            } else if (contract === "minting_data.spend") {
              console.log(
                "\n\n------- After Deploying Minting Data Spend Script -------\n"
              );
              console.log("!!! UPDATE SETTINGS DATUM !!!");
              console.log("\n");
            }
          },
        })),
        {
          title: "back",
          description: "Back to On Chain Actions",
          value: () => {
            finished = true;
          },
        },
      ],
    });
    await deployAction.action();
  }
};

const handleTxCbor = async (txCbor: string) => {
  const { filepath } = await prompts({
    name: "filepath",
    type: "text",
    message: "File Path to save Tx CBOR and dump",
  });
  await fs.writeFile(
    filepath,
    JSON.stringify({
      cbor: txCbor,
    })
  );
};

export { doOnChainActions };

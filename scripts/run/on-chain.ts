import { BlockFrostAPI } from "@blockfrost/blockfrost-js";
import { bytesToHex } from "@helios-lang/codec-utils";
import { makeAddress } from "@helios-lang/ledger";
import { NetworkName } from "@helios-lang/tx-utils";
import fs from "fs/promises";
import prompts from "prompts";

import {
  BLOCKFROST_API_KEY,
  CONTRACT_NAME,
  NETWORK,
} from "../../src/constants/index.js";
import {
  buildContracts,
  buildRefSpendSettingsData,
  buildRefSpendSettingsV1Data,
  buildSettingsData,
  buildSettingsV1Data,
  checkAccountRegistrationStatus,
  deploy,
  getBlockfrostV0Client,
  RefSpendSettings,
  RefSpendSettingsV1,
  registerStakingAddresses,
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
          title: "ref spend settings",
          description: "Build Ref Spend Settings Datum CBOR",
          value: async () => {
            const refSpendSettingsCbor = buildRefSpendSettingsDataCbor();
            console.log("\n\n------- Ref Spend Settings CBOR -------\n");
            console.log(refSpendSettingsCbor);
            console.log("\n");
          },
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
            const statuses = await checkAccountRegistrationStatus(
              blockfrostApi,
              stakingAddresses.mintStakingAddress,
              stakingAddresses.refSpendStakingAddress
            );
            console.log("\n\n------- Staking Addresses To Register -------\n");
            console.log(stakingAddresses);
            console.log("\n");
            const stakingAddressesToRegister: string[] = [];
            if (statuses.mintStakingAddress !== "registered") {
              console.log("Mint Staking Address is not registered");
              stakingAddressesToRegister.push(
                stakingAddresses.mintStakingAddress
              );
            }
            if (statuses.refSpendStakingAddress !== "registered") {
              console.log("Ref Spend Staking Address is not registered");
              stakingAddressesToRegister.push(
                stakingAddresses.refSpendStakingAddress
              );
            }
            if (stakingAddressesToRegister.length > 0) {
              console.log(
                "Please register the staking address(es) using Script CBOR, just a sec..."
              );
              const txCbor = await registerStakingAddresses(
                NETWORK as NetworkName,
                makeAddress(address),
                await blockfrostV0Client.getUtxos(address),
                stakingAddressesToRegister
              );
              await handleTxCbor(txCbor);
            } else {
              console.log("\nStaking Addresses are already registered\n");
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
    ORDERS_SPEND_RANDOMIZER,
    ROYALTY_SPEND_ADMIN,
    ALLOWED_MINTER,
    HAL_NFT_PRICE,
    PAYMENT_ADDRESS,
    MINTING_START_TIME,
    REF_SPEND_ADMIN,
  } = configs;

  const contractsConfig = buildContracts({
    isMainnet: (NETWORK as NetworkName) == "mainnet",
    mint_version: MINT_VERSION,
    admin_verification_key_hash: ADMIN_VERIFICATION_KEY_HASH,
    orders_spend_randomizer: ORDERS_SPEND_RANDOMIZER,
    royalty_spend_admin: ROYALTY_SPEND_ADMIN,
  });
  const {
    halPolicyHash,
    mint: mintConfig,
    mintingData: mintingDataConfig,
    ordersSpend: ordersSpendConfig,
    refSpendProxy: refSpendProxyConfig,
    refSpend: refSpendConfig,
    royaltySpend: royaltySpendConfig,
  } = contractsConfig;

  // we already have settings asset using legacy handle.
  const settingsV1: SettingsV1 = {
    policy_id: halPolicyHash.toHex(),
    allowed_minter: ALLOWED_MINTER,
    hal_nft_price: HAL_NFT_PRICE,
    minting_data_script_hash:
      mintingDataConfig.mintingDataValidatorHash.toHex(),
    orders_spend_script_hash:
      ordersSpendConfig.ordersSpendValidatorHash.toHex(),
    ref_spend_proxy_script_hash:
      refSpendProxyConfig.refSpendProxyValidatorHash.toHex(),
    ref_spend_governor: refSpendConfig.refSpendValidatorHash.toHex(),
    ref_spend_admin: REF_SPEND_ADMIN,
    royalty_spend_script_hash:
      royaltySpendConfig.royaltySpendValidatorHash.toHex(),
    minting_start_time: MINTING_START_TIME,
    payment_address: PAYMENT_ADDRESS,
  };
  const settings: Settings = {
    mint_governor: mintConfig.mintValidatorHash.toHex(),
    mint_version: MINT_VERSION,
    data: buildSettingsV1Data(settingsV1),
  };

  return bytesToHex(buildSettingsData(settings).toCbor());
};

const buildRefSpendSettingsDataCbor = () => {
  const configs = GET_CONFIGS(NETWORK as NetworkName);
  const {
    MINT_VERSION,
    ADMIN_VERIFICATION_KEY_HASH,
    ORDERS_SPEND_RANDOMIZER,
    ROYALTY_SPEND_ADMIN,
    REF_SPEND_ADMIN,
  } = configs;

  const contractsConfig = buildContracts({
    isMainnet: (NETWORK as NetworkName) == "mainnet",
    mint_version: MINT_VERSION,
    admin_verification_key_hash: ADMIN_VERIFICATION_KEY_HASH,
    orders_spend_randomizer: ORDERS_SPEND_RANDOMIZER,
    royalty_spend_admin: ROYALTY_SPEND_ADMIN,
  });
  const { halPolicyHash, refSpend: refSpendConfig } = contractsConfig;

  // we already have settings asset using legacy handle.
  const refSpendSettingsV1: RefSpendSettingsV1 = {
    policy_id: halPolicyHash.toHex(),
    ref_spend_admin: REF_SPEND_ADMIN,
  };
  const refSpendSettings: RefSpendSettings = {
    ref_spend_governor: refSpendConfig.refSpendValidatorHash.toHex(),
    data: buildRefSpendSettingsV1Data(refSpendSettingsV1),
  };

  return bytesToHex(buildRefSpendSettingsData(refSpendSettings).toCbor());
};

const getStakingAddresses = () => {
  const configs = GET_CONFIGS(NETWORK as NetworkName);
  const {
    MINT_VERSION,
    ADMIN_VERIFICATION_KEY_HASH,
    ORDERS_SPEND_RANDOMIZER,
    ROYALTY_SPEND_ADMIN,
  } = configs;

  const contractsConfig = buildContracts({
    isMainnet: (NETWORK as NetworkName) == "mainnet",
    mint_version: MINT_VERSION,
    admin_verification_key_hash: ADMIN_VERIFICATION_KEY_HASH,
    orders_spend_randomizer: ORDERS_SPEND_RANDOMIZER,
    royalty_spend_admin: ROYALTY_SPEND_ADMIN,
  });
  const { mint: mintConfig, refSpend: refSpendConfig } = contractsConfig;

  return {
    mintStakingAddress: mintConfig.mintStakingAddress.toBech32(),
    refSpendStakingAddress: refSpendConfig.refSpendStakingAddress.toBech32(),
  };
};

const doDeployActions = async () => {
  const configs = GET_CONFIGS(NETWORK as NetworkName);
  const {
    MINT_VERSION,
    ADMIN_VERIFICATION_KEY_HASH,
    ORDERS_SPEND_RANDOMIZER,
    ROYALTY_SPEND_ADMIN,
  } = configs;

  let finished: boolean = false;
  while (!finished) {
    const deployAction = await prompts({
      message: "Select Contract to Deploy",
      type: "select",
      name: "action",
      choices: [
        ...Object.values(CONTRACT_NAME).map((contract) => ({
          title: contract,
          description: contract,
          value: async () => {
            const deployData = await deploy({
              isMainnet: (NETWORK as NetworkName) == "mainnet",
              mintVersion: MINT_VERSION,
              adminVerificationKeyHash: ADMIN_VERIFICATION_KEY_HASH,
              ordersSpendRandomizer: ORDERS_SPEND_RANDOMIZER,
              royaltySpendAdmin: ROYALTY_SPEND_ADMIN,
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
            } else if (contract === "mint.withdraw") {
              console.log(
                "\n\n------- After Deploying Mint Withdraw Script -------\n"
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

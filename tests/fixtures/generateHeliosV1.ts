// Generator of heliosV1.json: what hal-minting-contracts 1.2.33 (Helios) produced for a fixed set of
// inputs. It only runs against a v1 checkout (Helios is gone from v2):
//   git -C <repo> worktree add /tmp/hmc-v1 b77e283 && (cd /tmp/hmc-v1 && npm ci)
//   (cd /tmp/hmc-v1 && npx tsx <this file> /tmp/hmc-v1 > heliosV1.json)
// tests/heliosParity.unit.ts rebuilds every value with v2 (cardano-sdk + scalus) and compares bytes.
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.argv[2];
const load = (rel: string) => import(pathToFileURL(path.join(root, rel)).href);

const main = async () => {
  const v1 = await load("src/index.ts");
  const { CONTRACT_NAME } = await load("src/constants/index.ts");
  const { makeAddress, makePubKeyHash, makeStakingValidatorHash } = await load("node_modules/@helios-lang/ledger/src/index.js");
  const { bytesToHex } = await load("node_modules/@helios-lang/codec-utils/src/index.js");
  const { Trie } = await load("node_modules/@aiken-lang/merkle-patricia-forestry/dist/index.js");
  const configs = {
    preview: await load("scripts/configs/preview.config.ts"),
    preprod: await load("scripts/configs/preprod.config.ts"),
    mainnet: await load("scripts/configs/mainnet.config.ts"),
  };
  const cbor = (data: { toCbor: () => number[] }) => bytesToHex(data.toCbor());

  const addresses = {
    previewBase: "addr_test1qpzakwt3g5fx2cqe0t0vskglqzr574gn4w932j86a9tq3g6at82wpmdq5cucr2l28ml298g504rgfgh5e30te2p6v4ksaju0af",
    previewEnterprise: makeAddress(false, makePubKeyHash("45db3971452265603379ebd8591f00874f5513ab8b1548faeb5608a3")).toBech32(),
    previewScriptStake: makeAddress(false, makePubKeyHash("a5ab40f280d88ae5904ec8df30974f10168854efafd4ecfce528092e"), makeStakingValidatorHash("608634513520c1ede320bdc04e0eb8877565d21de0e52273632e8fa3")).toBech32(),
    mainnetScriptScript: configs.mainnet.PAYMENT_ADDRESS.toBech32(),
    mainnetBase: makeAddress(true, makePubKeyHash("4da965a049dfd15ed1ee19fba6e2974a0b79fc416dd1796a1f97f5e1"), makePubKeyHash("5d59d4e0eda0a63981abea3efea29d147d4684a2f4cc5ebca8399576")).toBech32(),
  };
  const out: Record<string, unknown> = {
    _source: "hal-minting-contracts 1.2.33 (Helios, b77e283) via tests/fixtures/generateHeliosV1.ts",
    addresses,
  };

  // Plutus Address data (the whitelist MPT key) and order datums
  out.addressData = Object.fromEntries(
    Object.entries(addresses).map(([k, a]) => [k, bytesToHex(v1.getWhitelistedKey(makeAddress(a)))])
  );
  out.orderDatums = Object.entries(addresses).map(([k, a], i) => ({
    address: k,
    owner_key_hash: "ab".repeat(28),
    amount: i + 1,
    cbor: cbor(v1.buildOrderDatumData({ owner_key_hash: "ab".repeat(28), destination_address: makeAddress(a), amount: i + 1 })),
  }));

  // settings
  out.settings = Object.entries(configs).map(([network, c]) => {
    const built = v1.buildContracts({
      isMainnet: network === "mainnet",
      mint_version: c.MINT_VERSION,
      admin_verification_key_hash: c.ADMIN_VERIFICATION_KEY_HASH,
      orders_spend_randomizer: c.ORDERS_SPEND_RANDOMIZER,
      royalty_spend_admin: c.ROYALTY_SPEND_ADMIN,
    });
    const settingsV1 = {
      policy_id: built.halPolicyHash.toHex(),
      allowed_minter: c.ALLOWED_MINTER,
      hal_nft_price: c.HAL_NFT_PRICE,
      minting_data_script_hash: built.mintingData.mintingDataValidatorHash.toHex(),
      orders_spend_script_hash: built.ordersSpend.ordersSpendValidatorHash.toHex(),
      ref_spend_proxy_script_hash: built.refSpendProxy.refSpendProxyValidatorHash.toHex(),
      ref_spend_governor: built.refSpend.refSpendValidatorHash.toHex(),
      ref_spend_admin: c.REF_SPEND_ADMIN,
      royalty_spend_script_hash: built.royaltySpend.royaltySpendValidatorHash.toHex(),
      minting_start_time: c.MINTING_START_TIME,
      payment_address: c.PAYMENT_ADDRESS,
    };
    const deploys = Object.fromEntries(
      Object.values(CONTRACT_NAME as Record<string, string>).map((contractName) => [contractName, null])
    );
    return {
      network,
      settingsCbor: cbor(v1.buildSettingsData({ mint_governor: built.mint.mintValidatorHash.toHex(), mint_version: c.MINT_VERSION, data: v1.buildSettingsV1Data(settingsV1) })),
      refSpendSettingsCbor: cbor(v1.buildRefSpendSettingsData({ ref_spend_governor: built.refSpend.refSpendValidatorHash.toHex(), data: v1.buildRefSpendSettingsV1Data({ policy_id: built.halPolicyHash.toHex(), ref_spend_admin: c.REF_SPEND_ADMIN }) })),
      stakingAddresses: [built.mint.mintStakingAddress.toBech32(), built.refSpend.refSpendStakingAddress.toBech32()],
      deploys,
    };
  });
  for (const entry of out.settings as { network: keyof typeof configs; deploys: Record<string, unknown> }[]) {
    const c = configs[entry.network];
    for (const contractName of Object.keys(entry.deploys)) {
      const d = await v1.deploy({
        isMainnet: entry.network === "mainnet",
        mintVersion: c.MINT_VERSION,
        adminVerificationKeyHash: c.ADMIN_VERIFICATION_KEY_HASH,
        ordersSpendRandomizer: c.ORDERS_SPEND_RANDOMIZER,
        royaltySpendAdmin: c.ROYALTY_SPEND_ADMIN,
        contractName,
      });
      entry.deploys[contractName] = {
        optimizedCbor: d.optimizedCbor,
        datumCbor: d.datumCbor,
        validatorHash: d.validatorHash,
        policyId: d.policyId,
        scriptAddress: d.scriptAddress,
        scriptStakingAddress: d.scriptStakingAddress,
      };
    }
  }

  // minting data, proofs, whitelist
  const names = Array.from({ length: 40 }, (_, i) => `H.A.L. - ${String(i).padStart(3, "0")}`);
  const db = await Trie.fromList(names.map((key) => ({ key, value: "" })));
  const proofs = [];
  for (const name of [names[0], names[17], names[39]]) proofs.push([Buffer.from(name).toString("hex"), (await db.prove(name)).toJSON()]);
  const whitelistValue = [
    { time_gap: 3_600_000, amount: 2, price: 150_000_000n },
    { time_gap: 0, amount: 5, price: 170_000_000n },
  ];
  const wlDB = await Trie.fromList(
    Object.values(addresses).map((a) => ({ key: v1.getWhitelistedKey(makeAddress(a)), value: Buffer.from(v1.makeWhitelistedValueData(whitelistValue).toCbor()) }))
  );
  const wlProof = (await wlDB.prove(v1.getWhitelistedKey(makeAddress(addresses.previewBase)))).toJSON();
  const parsed = proofs.map(([hex, json]) => [hex, v1.parseMPTProofJSON(json)]);
  out.mintingData = {
    datum: { mpt_root_hash: db.hash.toString("hex"), whitelist_mpt_root_hash: wlDB.hash.toString("hex") },
    datumCbor: cbor(v1.buildMintingData({ mpt_root_hash: db.hash.toString("hex"), whitelist_mpt_root_hash: wlDB.hash.toString("hex") })),
    proofsJson: proofs,
    whitelistValue: whitelistValue.map((w) => ({ ...w, price: w.price.toString() })),
    whitelistValueCbor: cbor(v1.makeWhitelistedValueData(whitelistValue)),
    whitelistProofJson: wlProof,
    mintRedeemerCbor: cbor(
      v1.buildMintingDataMintRedeemer([
        [parsed.slice(0, 2), [whitelistValue, v1.parseMPTProofJSON(wlProof)]],
        [parsed.slice(2), undefined],
      ])
    ),
    updateMptRedeemerCbor: cbor(v1.buildMintingDataUpdateMPTRedeemer()),
  };

  // royalty
  out.royalty = {
    datumCbor: cbor(
      v1.buildRoyaltyDatumData({
        recipients: [
          { address: makeAddress(addresses.previewBase), fee: 1.6, min_fee: 1_000_000n, max_fee: undefined },
          { address: makeAddress(addresses.previewEnterprise), fee: 10, min_fee: undefined, max_fee: 50_000_000n },
        ],
        version: 1,
        extra: v1.buildRoyaltyFlagCIP68ExtraData(),
      })
    ),
  };

  out.redeemers = {
    mintNFTs: cbor(v1.buildMintMintNFTsRedeemer()),
    burnNFTs: cbor(v1.buildMintBurnNFTsRedeemer()),
    mintRoyaltyNFT: cbor(v1.buildMintMintRoyaltyNFTRedeemer()),
    executeOrders: cbor(v1.buildOrdersSpendExecuteOrdersRedeemer()),
    cancelOrder: cbor(v1.buildOrdersSpendCancelOrderRedeemer()),
    refundOrder: cbor(v1.buildOrdersSpendRefundOrderRedeemer()),
    royaltyUpdate: cbor(v1.buildRoyaltySpendUpdateRedeemer()),
    royaltyMigrate: cbor(v1.buildRoyaltySpendMigrateRedeemer()),
    void: cbor(v1.makeVoidData()),
  };

  console.log(JSON.stringify(out, (_, v) => (typeof v === "bigint" ? v.toString() : v), 1));
};

main();

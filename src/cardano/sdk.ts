// Single entry point for @cardano-sdk/core. Importing this module turns on Conway-era set tagging
// before any transaction CBOR is built (the node rejects untagged sets on Conway).
import { Cardano, Serialization, setInConwayEra } from "./core.cjs";

setInConwayEra(true);

export { Cardano, Serialization };
export type PlutusData = Serialization.PlutusData;
export type Utxo = Cardano.Utxo;

export const utxoRef = ([txIn]: Utxo): string => `${txIn.txId}#${txIn.index}`;

export const parseUtxoRef = (
  ref: string
): { txId: Cardano.TransactionId; index: number } => {
  const [txId, index] = ref.split("#");
  if (!/^[0-9a-f]{64}$/.test(txId ?? "") || !/^\d+$/.test(index ?? ""))
    throw new Error(`Invalid UTxO reference: ${ref}`);
  return { txId: Cardano.TransactionId(txId), index: Number(index) };
};

export const assetId = (policyId: string, assetNameHex: string) =>
  Cardano.AssetId.fromParts(
    Cardano.PolicyId(policyId),
    Cardano.AssetName(assetNameHex)
  );

export const networkIdFor = (isMainnet: boolean) =>
  isMainnet ? Cardano.NetworkId.Mainnet : Cardano.NetworkId.Testnet;

/** Payment credential (key or script hash) of a base or enterprise address. */
export const paymentCredentialOf = (bech32: string): Cardano.Credential => {
  const address = Cardano.Address.fromBech32(bech32);
  const credential = (
    address.asBase() ?? address.asEnterprise()
  )?.getPaymentCredential();
  if (!credential)
    throw new Error(
      `Unsupported address type (need base or enterprise): ${bech32}`
    );
  return credential;
};

const scriptCredential = (scriptHash: string): Cardano.Credential => ({
  type: Cardano.CredentialType.ScriptHash,
  hash: scriptHash as Cardano.Credential["hash"],
});

export const scriptAddress = (scriptHash: string, isMainnet: boolean): string =>
  Cardano.EnterpriseAddress.fromCredentials(
    networkIdFor(isMainnet),
    scriptCredential(scriptHash)
  )
    .toAddress()
    .toBech32();

export const scriptRewardAccount = (
  scriptHash: string,
  isMainnet: boolean
): Cardano.RewardAccount =>
  Cardano.RewardAddress.fromCredentials(
    networkIdFor(isMainnet),
    scriptCredential(scriptHash)
  )
    .toAddress()
    .toBech32() as Cardano.RewardAccount;

/** Pre-Conway stake registration certificate for a script credential (needs no witness). */
export const scriptStakeRegistration = (
  scriptHash: string
): Cardano.Certificate => ({
  __typename: Cardano.CertificateType.StakeRegistration,
  stakeCredential: scriptCredential(scriptHash),
});

/** Stake credential of a reward (stake) address. */
export const stakeCredentialOf = (rewardBech32: string): Cardano.Credential => {
  const credential = Cardano.Address.fromBech32(rewardBech32)
    .asReward()
    ?.getPaymentCredential();
  if (!credential) throw new Error(`Not a stake address: ${rewardBech32}`);
  return credential;
};

/** Does `utxo` hold at least `quantity` of `unit` (policy id ‖ asset name hex)? */
export const holdsAsset = (utxo: Utxo, unit: string, quantity = BigInt(1)) =>
  (utxo[1].value.assets?.get(unit as Cardano.AssetId) ?? BigInt(0)) >=
  quantity;

/** A UTxO's inline datum (undefined when it has none). */
export const inlineDatumOf = ([, output]: Utxo): PlutusData | undefined =>
  output.datum ? Serialization.PlutusData.fromCore(output.datum) : undefined;

export type NetworkName = "mainnet" | "preview" | "preprod";

// POSIX ms of (extrapolated) slot 0 — every slot since is 1 s (Shelley onwards).
const SLOT_ZERO_MS: Record<NetworkName, number> = {
  mainnet: 1591566291000,
  preview: 1666656000000,
  preprod: 1655683200000,
};

/** The slot containing `posixMs` (Shelley-era arithmetic; valid for every slot since Shelley). */
export const slotFromPosixMs = (posixMs: number, network: NetworkName): number =>
  Math.floor((posixMs - SLOT_ZERO_MS[network]) / 1000);

/** POSIX ms at the start of `slot`. */
export const posixMsFromSlot = (slot: number, network: NetworkName): number =>
  SLOT_ZERO_MS[network] + slot * 1000;

export const networkNameOf = (network: string): NetworkName => {
  const name = network.toLowerCase();
  if (name !== "mainnet" && name !== "preview" && name !== "preprod")
    throw new Error(`Unknown network ${network}`);
  return name;
};

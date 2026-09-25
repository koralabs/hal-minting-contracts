import {
  addressFromData,
  addressToData,
  bool,
  bytes,
  Cardano,
  constr,
  expectBytes,
  expectConstr,
  fromCbor,
  networkIdFor,
  option,
  PlutusData,
} from "../../cardano/index.js";

/** An output datum as the Plutus `Datum` type sees it (NoDatum is `undefined`). */
type OutputDatum =
  | { kind: "hash"; hash: string }
  | { kind: "inline"; data: PlutusData };

const makeBoolData = (value: boolean): PlutusData => bool(value);

/** Option<T>: `undefined` is None (0 / 0n / "" are Some — Helios treated every falsy value as None). */
const makeOptionData = <T>(
  value: T | undefined,
  builder: (value: T) => PlutusData
): PlutusData => option(value, builder);

const buildCredentialData = (credential: Cardano.Credential): PlutusData =>
  constr(credential.type === Cardano.CredentialType.KeyHash ? 0 : 1, [
    bytes(credential.hash),
  ]);

const decodeCredentialFromData = (data: PlutusData): Cardano.Credential => {
  const { tag, fields } = expectConstr(data, "Credential", undefined, 1);
  if (tag > 1) throw new Error("Invalid Credential Constr Tag");
  return {
    type:
      tag === 0
        ? Cardano.CredentialType.KeyHash
        : Cardano.CredentialType.ScriptHash,
    hash: expectBytes(fields[0], "Credential hash") as Cardano.Credential["hash"],
  };
};

const buildingStakingCredentialData = (
  stakingCredential: Cardano.Credential | undefined
): PlutusData =>
  option(stakingCredential, (credential) =>
    constr(0, [buildCredentialData(credential)])
  );

const decodeStakingCredentialFromData = (
  data: PlutusData
): Cardano.Credential | undefined => {
  const { tag, fields } = expectConstr(data, "Option<StakingCredential>");
  if (tag !== 0) return undefined;
  const inline = expectConstr(fields[0], "StakingCredential", 0, 1);
  return decodeCredentialFromData(inline.fields[0]);
};

/** Plutus `Address` of a bech32 base or enterprise address. */
const buildAddressData = (address: string): PlutusData => addressToData(address);

/** bech32 of a Plutus `Address`. */
const decodeAddressFromData = (data: PlutusData, isMainnet: boolean): string =>
  addressFromData(data, networkIdFor(isMainnet));

const decodeDatumFromData = (data: PlutusData): OutputDatum | undefined => {
  const { tag, fields } = expectConstr(data, "Datum");
  if (tag === 0) return undefined;
  if (tag === 1) return { kind: "hash", hash: expectBytes(fields[0], "DatumHash") };
  if (tag === 2) return { kind: "inline", data: fields[0] };
  throw new Error("Invalid Datum Constr Tag");
};

const buildDatumData = (datum: OutputDatum | undefined): PlutusData => {
  if (!datum) return constr(0);
  if (datum.kind === "hash") return constr(1, [bytes(datum.hash)]);
  return constr(2, [datum.data]);
};

const makeVoidData = (): PlutusData => fromCbor("d87980");

const makeRedeemerWrapper = (data: PlutusData): PlutusData => constr(1, [data]);

export type { OutputDatum };
export {
  buildAddressData,
  buildCredentialData,
  buildDatumData,
  buildingStakingCredentialData,
  decodeAddressFromData,
  decodeCredentialFromData,
  decodeDatumFromData,
  decodeStakingCredentialFromData,
  makeBoolData,
  makeOptionData,
  makeRedeemerWrapper,
  makeVoidData,
};

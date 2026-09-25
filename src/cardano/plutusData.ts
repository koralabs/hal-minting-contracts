// Plutus data construction/deconstruction on @cardano-sdk/core, including the Plutus `Address` type
//   Address           = Constr 0 [Credential, Option<StakingCredential>]
//   Credential        = Constr 0 [key hash] | Constr 1 [script hash]
//   StakingCredential = Constr 0 [Credential]  (inline; pointers are not supported)
//   Option            = Constr 0 [x] (Some) | Constr 1 [] (None)
// cardano-sdk serializes lists as indefinite arrays and chunks byte strings over 64 bytes — the same
// bytes Helios produced, which the MPT keys and on-chain datums depend on (see plutusData.test.ts).
import { Cardano, PlutusData, Serialization } from "./sdk.js";

export const constr = (alternative: number | bigint, fields: PlutusData[] = []): PlutusData => {
    const list = new Serialization.PlutusList();
    for (const field of fields) list.add(field);
    return Serialization.PlutusData.newConstrPlutusData(new Serialization.ConstrPlutusData(BigInt(alternative), list));
};

export const bytes = (hex: string | Uint8Array): PlutusData =>
    Serialization.PlutusData.newBytes(typeof hex === 'string' ? Buffer.from(hex, 'hex') : hex);

export const int = (value: bigint | number): PlutusData => Serialization.PlutusData.newInteger(BigInt(value));

export const list = (items: PlutusData[]): PlutusData => {
    const plutusList = new Serialization.PlutusList();
    for (const item of items) plutusList.add(item);
    return Serialization.PlutusData.newList(plutusList);
};

export const option = <T>(value: T | undefined, build: (value: T) => PlutusData): PlutusData =>
    value === undefined ? constr(1) : constr(0, [build(value)]);

export const fromCbor = (cborHex: string): PlutusData => Serialization.PlutusData.fromCbor(cborHex as never);

export const toCbor = (data: PlutusData): string => data.toCbor();

export const expectConstr = (data: PlutusData, what: string, alternative?: number, fieldCount?: number) => {
    const c = data.asConstrPlutusData();
    if (!c) throw new Error(`${what} must be Constr data`);
    const tag = Number(c.getAlternative());
    if (alternative !== undefined && tag !== alternative) throw new Error(`${what} must be Constr ${alternative}, got ${tag}`);
    const fields = c.getData();
    if (fieldCount !== undefined && fields.getLength() !== fieldCount) {
        throw new Error(`${what} must have ${fieldCount} fields, got ${fields.getLength()}`);
    }
    return { tag, fields: Array.from({ length: fields.getLength() }, (_, i) => fields.get(i)) };
};

export const expectBytes = (data: PlutusData, what: string): string => {
    const b = data.asBoundedBytes();
    if (!b) throw new Error(`${what} must be ByteArray data`);
    return Buffer.from(b).toString('hex');
};

export const expectInt = (data: PlutusData, what: string): bigint => {
    const i = data.asInteger();
    if (i === undefined) throw new Error(`${what} must be Int data`);
    return i;
};

export const expectList = (data: PlutusData, what: string): PlutusData[] => {
    const l = data.asList();
    if (!l) throw new Error(`${what} must be List data`);
    return Array.from({ length: l.getLength() }, (_, i) => l.get(i));
};

const credentialData = (credential: Cardano.Credential) =>
    constr(credential.type === Cardano.CredentialType.KeyHash ? 0 : 1, [bytes(credential.hash)]);

export const addressToData = (bech32: string): PlutusData => {
    const address = Cardano.Address.fromBech32(bech32);
    const base = address.asBase();
    const enterprise = address.asEnterprise();
    if (!base && !enterprise) throw new Error(`Unsupported address type for Plutus Address: ${bech32}`);
    const payment = (base ?? enterprise)!.getPaymentCredential();
    return constr(0, [credentialData(payment), option(base?.getStakeCredential(), (stake) => constr(0, [credentialData(stake)]))]);
};

const decodeCredential = (data: PlutusData, what: string): Cardano.Credential => {
    const { tag, fields } = expectConstr(data, what, undefined, 1);
    if (tag > 1) throw new Error(`${what} has invalid Credential tag ${tag}`);
    return {
        type: tag === 0 ? Cardano.CredentialType.KeyHash : Cardano.CredentialType.ScriptHash,
        hash: expectBytes(fields[0], what) as Cardano.Credential['hash']
    };
};

export const addressFromData = (data: PlutusData, networkId: Cardano.NetworkId): string => {
    const { fields } = expectConstr(data, 'Address', 0, 2);
    const payment = decodeCredential(fields[0], 'Address.payment');
    const stakingOption = expectConstr(fields[1], 'Address.staking');
    if (stakingOption.tag === 1) return Cardano.EnterpriseAddress.fromCredentials(networkId, payment).toAddress().toBech32();
    if (stakingOption.tag !== 0) throw new Error(`Address.staking has invalid Option tag ${stakingOption.tag}`);
    const staking = expectConstr(stakingOption.fields[0], 'StakingCredential', 0, 1);
    const stake = decodeCredential(staking.fields[0], 'Address.stake');
    return Cardano.BaseAddress.fromCredentials(networkId, payment, stake).toAddress().toBech32();
};

export const bool = (value: boolean): PlutusData => constr(value ? 1 : 0);

export const map = (entries: [PlutusData, PlutusData][]): PlutusData => {
    const plutusMap = new Serialization.PlutusMap();
    for (const [key, value] of entries) plutusMap.insert(key, value);
    return Serialization.PlutusData.newMap(plutusMap);
};

/** Constr 0 [] — the unit / "void" redeemer. */
export const voidData = (): PlutusData => constr(0);

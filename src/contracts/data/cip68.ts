import { constr, int, PlutusData } from "../../cardano/index.js";

const buildRoyaltyFlagCIP68ExtraData = (): PlutusData => constr(0, [int(1)]);

export { buildRoyaltyFlagCIP68ExtraData };

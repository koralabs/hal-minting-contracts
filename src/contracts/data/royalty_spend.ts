import { constr, PlutusData } from "../../cardano/index.js";

const buildRoyaltySpendUpdateRedeemer = (): PlutusData => constr(0);

const buildRoyaltySpendMigrateRedeemer = (): PlutusData => constr(1);

export { buildRoyaltySpendMigrateRedeemer, buildRoyaltySpendUpdateRedeemer };

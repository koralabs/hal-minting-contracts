import { bytes, constr, int, list, PlutusData } from "../../cardano/index.js";
import { MPTProof, MPTProofStep, Neighbor } from "../types/index.js";

const buildMPTProofData = (proof: MPTProof): PlutusData =>
  list(proof.map(buildMPTProofStepData));

const buildMPTProofStepData = (proofStep: MPTProofStep): PlutusData => {
  if (proofStep.type == "branch")
    return constr(0, [int(proofStep.skip), bytes(proofStep.neighbors)]);
  if (proofStep.type == "fork")
    return constr(1, [int(proofStep.skip), buildNeighborData(proofStep.neighbor)]);
  return constr(2, [
    int(proofStep.skip),
    bytes(proofStep.key),
    bytes(proofStep.value),
  ]);
};

const buildNeighborData = (neighbor: Neighbor): PlutusData =>
  constr(0, [int(neighbor.nibble), bytes(neighbor.prefix), bytes(neighbor.root)]);

export { buildMPTProofData, buildMPTProofStepData, buildNeighborData };

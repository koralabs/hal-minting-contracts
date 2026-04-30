# Spec Docs

The spec docs describe how `hal-minting-contracts` is assembled and operated at the implementation level. They are intended for engineers reviewing contract logic, deployment drift, data encodings, and testing coverage.

- [Technical Spec](./spec.md)  
  High-level architecture, module boundaries, runtime flow, and critical invariants.
- [Contract Deployment Pipeline](./contract-deployment-pipeline.md)  
  Desired-state YAML model, drift detection, planner artifacts, and approval boundaries.
- [Data Model](./data-model.md)  
  Core constants, handles, datum types, proof shapes, and deployment-state schema.
- [Validator Catalog](./validator-catalog.md)  
  Contract-by-contract breakdown of purpose, parameterization, datum/redeemer surfaces, and governing rules.

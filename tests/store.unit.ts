import { Trie } from "@aiken-lang/merkle-patricia-forestry";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addAsset,
  clear,
  fillAssets,
  init,
  printProof,
  removeAsset,
} from "../src/store/index.js";

const rootHex = (db: Trie) =>
  db.hash ? db.hash.toString("hex") : "empty";

describe("store (merkle-patricia-forestry wrapper)", () => {
  let folder: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), "hal-store-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(async () => {
    logSpy.mockRestore();
    await fs.rm(folder, { recursive: true, force: true });
  });

  it("fillAssets inserts every asset, reports progress, and matches an independently built trie", async () => {
    const db = await init(folder);
    const empty = rootHex(db);
    const progress = vi.fn();
    await fillAssets(db, ["hal-1", "hal-2", "hal-3"], progress);
    expect(progress).toHaveBeenCalledTimes(3);
    expect(rootHex(db)).not.toBe(empty);

    const ref = await Trie.fromList([
      { key: "hal-1", value: "" },
      { key: "hal-2", value: "" },
      { key: "hal-3", value: "" },
    ]);
    expect(rootHex(db)).toBe(rootHex(ref));
  });

  it("addAsset then removeAsset restores the previous root; removing an absent key throws", async () => {
    const db = await init(folder);
    await fillAssets(db, ["a", "b"], () => {});
    const before = rootHex(db);
    await addAsset(db, "c", "v");
    expect(rootHex(db)).not.toBe(before);
    await removeAsset(db, "c");
    expect(rootHex(db)).toBe(before);
    await expect(removeAsset(db, "zzz")).rejects.toThrow();
  });

  it("printProof emits a proof that verifies against the root, in json and cbor", async () => {
    const db = await init(folder);
    await fillAssets(db, ["x", "y", "z"], () => {});
    logSpy.mockClear();
    await printProof(db, "y", "json");
    const json = logSpy.mock.calls[0][0];
    expect(Array.isArray(json)).toBe(true);
    const proof = await db.prove("y");
    expect(proof.verify(true).toString("hex")).toBe(rootHex(db));
    expect(json).toEqual(proof.toJSON());

    logSpy.mockClear();
    await printProof(db, "y", "cborHex");
    expect(logSpy.mock.calls[0][0]).toBe(proof.toCBOR().toString("hex"));
    await expect(printProof(db, "absent", "json")).rejects.toThrow();
  });

  // Note: the level Store opens lazily and may recreate an empty folder after
  // clear() if a Trie is still open on it, so assert prior contents are gone.
  it("clear deletes the folder's existing contents", async () => {
    const marker = path.join(folder, "marker");
    await fs.writeFile(marker, "x");
    await clear(folder);
    await expect(fs.stat(marker)).rejects.toThrow();
    await expect(clear(folder)).rejects.toThrow();
  });
});

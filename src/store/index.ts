import { Store, Trie } from "@aiken-lang/merkle-patricia-forestry";
import fs from "fs/promises";

const init = async (folder: string): Promise<Trie> => {
  const store = new Store(folder);
  // Open the level DB before use; without this it opens in the background and
  // early reads can fail with LEVEL_NOT_FOUND.
  await store.ready();
  const db = new Trie(store);
  // @ts-expect-error: Library issue
  await db.save();
  return db;
};

const inspect = (db: Trie) => {
  // console.log(db.hash?.toString("hex") || Buffer.alloc(32).toString("hex"));
  console.log(db);
};

const clear = async (folder: string) => {
  await fs.rm(folder, { recursive: true });
};

const fillAssets = async (db: Trie, assets: string[], progress: () => void) => {
  for (const asset of assets) {
    await db.insert(asset, "");
    progress();
  }
  console.log(db);
};

const addAsset = async (db: Trie, key: string, value: string) => {
  await db.insert(key, value);
  console.log(db);
};

const removeAsset = async (db: Trie, key: string) => {
  await db.delete(key);
  console.log(db);
};

const printProof = async (
  db: Trie,
  key: string,
  format: "json" | "cborHex"
) => {
  const proof = await db.prove(key);
  switch (format) {
    case "json":
      console.log(proof.toJSON());
      break;
    case "cborHex":
      console.log(proof.toCBOR().toString("hex"));
      break;
  }
};

export { addAsset, clear, fillAssets, init, inspect, printProof, removeAsset };

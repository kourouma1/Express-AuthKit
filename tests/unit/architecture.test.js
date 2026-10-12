import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../src");
const IMPORT_PATTERN = /^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gm;

async function listSourceFiles(directory = SRC) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return listSourceFiles(path);
      return entry.name.endsWith(".js") ? [path] : [];
    })
  );
  return nested.flat();
}

async function buildImportGraph() {
  const graph = new Map();
  for (const file of await listSourceFiles()) {
    const source = await readFile(file, "utf8");
    const specifiers = [...source.matchAll(IMPORT_PATTERN)].map((match) => match[1]);
    graph.set(file, specifiers.map((specifier) => (specifier.startsWith(".") ? resolve(dirname(file), specifier) : specifier)));
  }
  return graph;
}

describe("architecture rules", () => {
  it("keeps the core free of frameworks, persistence and providers", async () => {
    const graph = await buildImportGraph();
    for (const [file, imports] of graph) {
      if (!relative(SRC, file).startsWith("core")) continue;
      for (const target of imports) {
        const isInsideCore = target.startsWith(join(SRC, "core"));
        assert.ok(isInsideCore, `${relative(SRC, file)} must only import core modules, found ${target}`);
      }
    }
  });

  it("keeps the Express adapter free of a runtime dependency on express", async () => {
    const graph = await buildImportGraph();
    for (const [file, imports] of graph) {
      if (!relative(SRC, file).startsWith("adapters")) continue;
      assert.ok(!imports.includes("express"), `${relative(SRC, file)} must not import express`);
    }
  });

  it("has no circular imports", async () => {
    const graph = await buildImportGraph();
    const state = new Map();
    const visit = (file, path) => {
      if (state.get(file) === "done") return;
      assert.notEqual(state.get(file), "visiting", `Circular import: ${[...path, file].map((f) => relative(SRC, f)).join(" -> ")}`);
      state.set(file, "visiting");
      for (const target of graph.get(file) ?? []) {
        if (graph.has(target)) visit(target, [...path, file]);
      }
      state.set(file, "done");
    };
    for (const file of graph.keys()) visit(file, []);
  });

  it("never logs from library code", async () => {
    for (const file of await listSourceFiles()) {
      const source = await readFile(file, "utf8");
      assert.equal(/^\s*console\.\w+\(/m.test(source), false, `${relative(SRC, file)} must not use console`);
    }
  });
});

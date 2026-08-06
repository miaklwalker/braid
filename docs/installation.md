---
title: "Installation"
description: "Add Braid to a project: zero runtime dependencies, shipped as TypeScript source."
---

```bash
npm install @michaelrwalker/braid
```

## What you get

If your setup already compiles TypeScript through a bundler like esbuild,
Vite, or tsup, or through a `tsc` build with `noEmit: false`, you're all set:
Braid works as-is, nothing else to configure.

If it doesn't: Braid ships as TypeScript source rather than a compiled `.js`
file with a `.d.ts` shadow next to it, so your toolchain needs to resolve and
transform `.ts` files straight out of `node_modules`. `package.json` points
`main` and `types` both at `main.ts`:

```json
{
	"main": "main.ts",
	"types": "main.ts",
	"exports": { ".": "./main.ts" }
}
```

It also has no runtime dependencies. One upside of shipping source: your
editor jumps to real, commented code when you go to definition on `Braid`,
`.main()`, or `.join()`, not a stripped declaration file.

## Importing

```ts
import { Braid } from "@michaelrwalker/braid";
```

Everything the package exports — `Braid`, `BraidError`, `InferBraidRow`,
`groupBy`, `indexBy`, `isJoinableKey`, and the supporting types — comes from
that single entry point. See [Braid API](reference/api) and
[Configuration fields](reference/configuration) for the full surface.

## Running the examples locally

If you've cloned the repository rather than installed the package, the
examples run directly under Node's experimental TypeScript support, with no
build step:

```bash
node --experimental-transform-types --disable-warning=ExperimentalWarning examples/basic.ts
```

#!/usr/bin/env node
const major = Number(process.versions.node.split(".")[0]);
if (major < 22) {
  process.stderr.write(`enrichr needs Node 22 or newer (this is ${process.versions.node}).\n`);
  process.exit(1);
}
const { main } = await import("../src/cli.mjs");
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));
process.exitCode = await main(process.argv.slice(2));

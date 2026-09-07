import { copyFileSync, existsSync, mkdirSync, constants } from "node:fs";

if (Number(process.versions.node.split(".")[0]) < 22) {
  console.error("Please install Node.js 24 LTS, then run npm run setup again.");
  process.exit(1);
}
mkdirSync("data", { recursive: true });
if (!existsSync(".env.local")) {
  copyFileSync(".env.example", ".env.local", constants.COPYFILE_EXCL);
  console.log("Created .env.local. Your private settings belong in this file.");
} else {
  console.log("Kept your existing .env.local unchanged.");
}
console.log("Run npm run dev, then open http://127.0.0.1:3000. The empty dashboard works without API keys.");
console.log("Ask Claude Code to guide you through Plaid Sandbox when you are ready to connect test accounts.");

import { wait } from "../src/wait";
import * as process from "process";
import * as cp from "child_process";
import * as path from "path";
import { expect, test } from "@jest/globals";
import dotenv from "dotenv";

dotenv.config();

test("wait 500 ms", async () => {
  const start = new Date();
  await wait(500);
  const end = new Date();
  var delta = Math.abs(end.getTime() - start.getTime());
  expect(delta).toBeGreaterThan(450);
});

// shows how the runner will run a javascript action with env / stdout protocol
test("test runs", () => {
  if (!process.env.DEPLOYER_KEYPAIR) {
    console.log("Skipping test - DEPLOYER_KEYPAIR not set");
    return;
  }

  console.log("Starting test execution...");
  process.env["INPUT_NETWORK-URL"] = "https://api.devnet.solana.com";
  process.env["INPUT_PROGRAM-MULTISIG"] =
    "7Jsv2aZycozXZJTBLGvRQkWfMTbKBDmk7MrgrAPzryC";
  process.env["INPUT_PROGRAM-ID"] =
    "credMBJhYFzfn7NxBMdU4aUqFggAjgztaCcv2Fo6fPT";
  process.env["INPUT_PROGRAM-INDEX"] = "1";
  process.env["INPUT_BUFFER"] = "fSyKcbNa15WwcqKZsHUCmXV2Vw8G5wjUW48omTjRqxn";
  process.env["INPUT_IDL-BUFFER"] =
    "9Bd3Ti88kLFJxBRkWojvBWkEHvJuj8QeWtHrq2APv9y6";
  process.env["INPUT_SPILL-ADDRESS"] =
    "devXCnFPU71StPEFNnGRf4iqXoRpYkNsGEg9m757ktP";
  process.env["INPUT_AUTHORITY"] =
    "EwCiHKYRDrHfsaTv7S1Lf49yYbr62oFBaN3MVgzv9NU4";
  process.env["INPUT_NAME"] = "TEST";
  process.env["INPUT_KEYPAIR"] = process.env.DEPLOYER_KEYPAIR;
  const np = process.execPath;
  const ip = path.join(__dirname, "..", "lib", "main.js");
  console.log("Executing main.js at path:", ip);
  const options: cp.ExecFileSyncOptions = {
    env: process.env,
    stdio: "inherit", // This will pipe output directly to the console
  };
  try {
    const result = cp.execFileSync(np, [ip], options);
    console.log("Execution completed:", result?.toString());
  } catch (error) {
    console.error("Error executing main.js:", error);
    throw error;
  }
});

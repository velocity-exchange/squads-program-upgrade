// eslint-disable-next-line filenames/match-regex
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
  batchInstructionsToTxsWithPriorityFee,
  sendInstructions,
} from "@helium/spl-utils";
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
} from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import { createProgramUpgradeInstruction } from "./createProgramUpgradeInstruction";
import {
  buildApplyIdlInstructions,
  createCloseBufferInstruction,
} from "./programMetadata";

export const createProgramUpgrade = async ({
  multisig: multisigPda,
  programId,
  buffer,
  spill,
  authority,
  wallet,
  networkUrl,
  idlBuffer,
  name,
}: {
  multisig: PublicKey;
  programId: PublicKey;
  buffer: PublicKey;
  spill: PublicKey;
  authority: PublicKey;
  idlBuffer?: PublicKey;
  wallet: Keypair;
  networkUrl: string;
  name: string;
}) => {
  const connection = new Connection(networkUrl, "confirmed");

  const instructions: TransactionInstruction[] = [];

  if (idlBuffer) {
    // Anchor 1.0 stores IDLs in the program-metadata-program. Apply the staged
    // buffer to the canonical metadata account (creating it if it doesn't exist
    // yet — fund + allocate + extend + write + initialize), then close the
    // buffer to refund its rent.
    const idlInstructions = await buildApplyIdlInstructions({
      connection,
      programId,
      idlBuffer,
      authority,
    });
    instructions.push(
      ...idlInstructions,
      createCloseBufferInstruction(idlBuffer, authority, spill)
    );
  }

  // BPF Loader upgrade — replaces the on-chain program code with the staged buffer.
  instructions.push(
    await createProgramUpgradeInstruction(programId, buffer, authority, spill)
  );

  const multisigInfo = await multisig.accounts.Multisig.fromAccountAddress(
    connection,
    multisigPda
  );

  const transactionIndex = Number(multisigInfo.transactionIndex);
  const newTransactionIndex = BigInt(transactionIndex + 1);
  const message = new TransactionMessage({
    payerKey: authority,
    recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
    instructions,
  });
  const transactionCreateIx =
    await multisig.instructions.vaultTransactionCreate({
      multisigPda,
      transactionIndex: newTransactionIndex,
      creator: wallet.publicKey,
      vaultIndex: 0,
      ephemeralSigners: 0,
      transactionMessage: message,
      memo: name,
    });
  const proposalCreateIx = await multisig.instructions.proposalCreate({
    multisigPda,
    transactionIndex: newTransactionIndex,
    // Must have "Voter" permissions at minimum
    creator: wallet.publicKey,
  });

  const realIxns = [transactionCreateIx, proposalCreateIx];

  const provider = new AnchorProvider(
    connection,
    new Wallet(wallet),
    AnchorProvider.defaultOptions()
  );
  const txnDrafts = await batchInstructionsToTxsWithPriorityFee(
    provider,
    realIxns
  );
  const txids: string[] = [];
  for (const txnDraft of txnDrafts) {
    const txid = await sendInstructions(provider, txnDraft.instructions);
    txids.push(txid);
  }
  console.log(
    `Created Squads proposal #${newTransactionIndex} for program ${programId.toBase58()} on multisig ${multisigPda.toBase58()}.`
  );
  console.log(
    `Transactions: ${txids
      .map((txid) => `https://explorer.solana.com/tx/${txid}`)
      .join(", ")}`
  );
  return txids;
};

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
  buildApplyIdlInstructionGroups,
  createCloseBufferInstruction,
} from "./programMetadata";

const VAULT_INDEX = 0;

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

  // Assemble the work as per-transaction instruction groups. An IDL apply may
  // need several transactions (each grows the metadata account by <=10 KiB,
  // the CPI realloc cap); the BPF upgrade is one instruction with no realloc.
  // close + upgrade ride along in the final group (neither reallocs).
  const groups: TransactionInstruction[][] = idlBuffer
    ? await buildApplyIdlInstructionGroups({
        connection,
        programId,
        idlBuffer,
        authority,
      })
    : [];

  const tail: TransactionInstruction[] = [];
  if (idlBuffer) {
    tail.push(createCloseBufferInstruction(idlBuffer, authority, spill));
  }
  // BPF Loader upgrade — replaces the on-chain program code with the staged buffer.
  tail.push(
    await createProgramUpgradeInstruction(programId, buffer, authority, spill)
  );

  if (groups.length === 0) {
    groups.push(tail);
  } else {
    groups[groups.length - 1]!.push(...tail);
  }

  const multisigInfo = await multisig.accounts.Multisig.fromAccountAddress(
    connection,
    multisigPda
  );
  const transactionIndex = BigInt(Number(multisigInfo.transactionIndex) + 1);

  const provider = new AnchorProvider(
    connection,
    new Wallet(wallet),
    AnchorProvider.defaultOptions()
  );

  const { blockhash } = await connection.getLatestBlockhash();
  const toMessage = (instructions: TransactionInstruction[]) =>
    new TransactionMessage({
      payerKey: authority, // the Squads vault PDA executes each transaction
      recentBlockhash: blockhash,
      instructions,
    });

  const txids: string[] = [];

  if (groups.length === 1) {
    // Single transaction — a plain vault transaction + proposal.
    const createIx = multisig.instructions.vaultTransactionCreate({
      multisigPda,
      transactionIndex,
      creator: wallet.publicKey,
      vaultIndex: VAULT_INDEX,
      ephemeralSigners: 0,
      transactionMessage: toMessage(groups[0]!),
      memo: name,
    });
    const proposalCreateIx = multisig.instructions.proposalCreate({
      multisigPda,
      transactionIndex,
      // Must have "Voter" permissions at minimum
      creator: wallet.publicKey,
    });
    const txnDrafts = await batchInstructionsToTxsWithPriorityFee(provider, [
      createIx,
      proposalCreateIx,
    ]);
    for (const txnDraft of txnDrafts) {
      txids.push(await sendInstructions(provider, txnDraft.instructions));
    }
  } else {
    // Multiple transactions — a Squads batch: one proposal, executed as N
    // transactions. Sent step by step so the on-chain ordering is strict
    // (create → draft proposal → add each tx → activate).
    console.log(
      `IDL apply needs ${groups.length} transactions; creating a Squads batch (proposal #${transactionIndex}).`
    );
    txids.push(
      await sendInstructions(provider, [
        multisig.instructions.batchCreate({
          multisigPda,
          creator: wallet.publicKey,
          rentPayer: wallet.publicKey,
          batchIndex: transactionIndex,
          vaultIndex: VAULT_INDEX,
          memo: name,
        }),
        multisig.instructions.proposalCreate({
          multisigPda,
          transactionIndex,
          creator: wallet.publicKey,
          isDraft: true,
        }),
      ])
    );

    for (let i = 0; i < groups.length; i++) {
      txids.push(
        await sendInstructions(provider, [
          multisig.instructions.batchAddTransaction({
            vaultIndex: VAULT_INDEX,
            multisigPda,
            member: wallet.publicKey,
            rentPayer: wallet.publicKey,
            batchIndex: transactionIndex,
            transactionIndex: i + 1, // 1-based index within the batch
            ephemeralSigners: 0,
            transactionMessage: toMessage(groups[i]!),
          }),
        ])
      );
    }

    txids.push(
      await sendInstructions(provider, [
        multisig.instructions.proposalActivate({
          multisigPda,
          transactionIndex,
          member: wallet.publicKey,
        }),
      ])
    );
  }

  console.log(
    `Created Squads proposal #${transactionIndex} for program ${programId.toBase58()} on multisig ${multisigPda.toBase58()} (${
      groups.length
    } transaction(s)).`
  );
  console.log(
    `Transactions: ${txids
      .map((txid) => `https://explorer.solana.com/tx/${txid}`)
      .join(", ")}`
  );
  return txids;
};

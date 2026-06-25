/**
 * Anchor 1.0 IDL flow: program-metadata-program
 * (https://github.com/solana-program/program-metadata).
 *
 * Anchor 1.0 removed the legacy IDL instructions baked into each program
 * (`IdlInstruction::Upgrade`, the `nJWGUMOK`-style discriminator) and moved
 * IDL storage out to a separate `ProgM6JCCvbYkfKqJYHePx4xxSUSqJp7rh8Lyv7nk7S`
 * program. The canonical IDL lives in a metadata account at
 * seeds = [programId, "idl" padded to 16 bytes], whose update authority is the
 * program's upgrade authority (the Squads vault, in our case).
 *
 * Applying a pre-staged IDL buffer is NOT a single instruction. Creating the
 * canonical account from scratch requires the program-metadata program's
 * five-step sequence — fund rent, Allocate, Extend (in <=10 KiB chunks), Write
 * (copy the staged buffer in), Initialize — and updating an existing one
 * requires [fund + Extend if it grew] then SetData. We build those exact
 * sequences with the official @solana-program/program-metadata instruction
 * builders (the source of truth for wire format) and convert the resulting
 * @solana/kit instructions to legacy `TransactionInstruction`s so they can be
 * wrapped in a Squads vault transaction. All instructions for a given IDL fit
 * comfortably in one transaction because the data arrives by buffer copy, not
 * inline.
 */
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { address, createNoopSigner } from "@solana/kit";
import * as pm from "@solana-program/program-metadata";

/** Brand a web3.js PublicKey as a @solana/kit Address for the pm builders. */
const addr = (pk: PublicKey) => address(pk.toBase58());

// The pm builders type `authority` as a TransactionSigner. We never sign here —
// the Squads vault signs via invoke_signed at execution — so wrap the authority
// pubkey in a noop signer. This still sets the correct signer role on the
// generated account meta.
const noopSigner = (pk: PublicKey) => createNoopSigner(addr(pk));

export const PROGRAM_METADATA_PROGRAM_ID = new PublicKey(
  "ProgM6JCCvbYkfKqJYHePx4xxSUSqJp7rh8Lyv7nk7S"
);

const BPF_UPGRADE_LOADER_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);

// program-metadata account layout: 96-byte header followed by the data.
const ACCOUNT_HEADER_LENGTH = 96;
// Solana caps a single account resize at MAX_PERMITTED_DATA_INCREASE (10 KiB),
// so growth beyond that must be split across multiple Extend instructions.
const REALLOC_LIMIT = 10240;

const IDL_SEED = "idl";

// Encoding/Compression/Format the program-metadata CLI uses for an IDL written
// from a `create-buffer`d JSON (utf8 + zlib + json, stored directly).
const IDL_DATA_SHAPE = {
  encoding: pm.Encoding.Utf8,
  compression: pm.Compression.Zlib,
  format: pm.Format.Json,
  dataSource: pm.DataSource.Direct,
};

/**
 * Canonical metadata PDA — managed by the program's upgrade authority.
 * seeds = [programId, "idl" padded to 16 bytes].
 */
export function findIdlMetadataPda(programId: PublicKey): PublicKey {
  const seed = Buffer.alloc(16, 0);
  seed.write(IDL_SEED, 0, "utf8");
  const [pda] = PublicKey.findProgramAddressSync(
    [programId.toBuffer(), seed],
    PROGRAM_METADATA_PROGRAM_ID
  );
  return pda;
}

/** Program data PDA under the BPF Upgradeable Loader. */
export function findProgramDataPda(programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_UPGRADE_LOADER_ID
  );
  return pda;
}

// @solana/kit AccountRole: 0 READONLY, 1 WRITABLE, 2 READONLY_SIGNER,
// 3 WRITABLE_SIGNER. The builders mark `authority`/`payer` as non-signers when
// given a plain address; on-chain they must sign, which the Squads vault does
// via invoke_signed — so force the signer flag for the authority pubkey.
function toLegacy(
  ix: {
    programAddress: string;
    accounts: readonly { address: string; role: number }[];
    data: ArrayLike<number>;
  },
  authority: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programAddress),
    keys: ix.accounts.map((a) => {
      const pubkey = new PublicKey(a.address);
      return {
        pubkey,
        isWritable: a.role === 1 || a.role === 3,
        isSigner: a.role === 2 || a.role === 3 || pubkey.equals(authority),
      };
    }),
    data: Buffer.from(ix.data),
  });
}

/** Split a desired byte growth into <=REALLOC_LIMIT chunks. */
function extendChunks(totalBytes: number): number[] {
  const chunks: number[] = [];
  let remaining = totalBytes;
  while (remaining > 0) {
    const len = Math.min(REALLOC_LIMIT, remaining);
    chunks.push(len);
    remaining -= len;
  }
  return chunks;
}

/**
 * Build the instructions that apply a pre-staged IDL buffer to the canonical
 * metadata account, creating the account first if it doesn't exist yet —
 * grouped into per-transaction chunks.
 *
 * Each returned inner array is one transaction's worth of instructions, sized
 * so its total account growth is <= REALLOC_LIMIT. That bound matters because
 * the Squads vault executes every instruction via CPI, and the runtime caps
 * cumulative account-data growth at 10 KiB *per transaction* for inner
 * instructions ("realloc limited to 10240 in inner instructions"). A large IDL
 * therefore can't be created in one transaction — the `Extend`s must be spread
 * across several, which the caller wraps in a Squads batch (one proposal, many
 * executed transactions).
 *
 * Does NOT close the buffer or upgrade the program — the caller appends those
 * (neither reallocs) to the final group.
 */
export async function buildApplyIdlInstructionGroups({
  connection,
  programId,
  idlBuffer,
  authority,
}: {
  connection: Connection;
  programId: PublicKey;
  idlBuffer: PublicKey;
  authority: PublicKey;
}): Promise<TransactionInstruction[][]> {
  const metadata = findIdlMetadataPda(programId);
  const programData = findProgramDataPda(programId);

  const bufferAccount = await connection.getAccountInfo(idlBuffer, "confirmed");
  if (!bufferAccount) {
    throw new Error(`IDL buffer ${idlBuffer.toBase58()} not found on chain`);
  }
  // The staged buffer is itself a program-metadata account: header + the data
  // we'll copy into the canonical account, so they share the same data length.
  const dataLength = bufferAccount.data.length - ACCOUNT_HEADER_LENGTH;
  const requiredAccountSize = ACCOUNT_HEADER_LENGTH + dataLength;

  const common = {
    metadata: addr(metadata),
    authority: noopSigner(authority),
    program: addr(programId),
    programData: addr(programData),
  };

  const extendIx = (length: number) =>
    toLegacy(
      pm.getExtendInstruction({
        account: common.metadata,
        authority: common.authority,
        program: common.program,
        programData: common.programData,
        length,
      }),
      authority
    );

  const groups: TransactionInstruction[][] = [];
  const metadataAccount = await connection.getAccountInfo(
    metadata,
    "confirmed"
  );

  if (!metadataAccount) {
    console.log(
      `IDL metadata PDA ${metadata.toBase58()} not initialized; create flow (fund + allocate + extend*${
        extendChunks(dataLength).length
      } + write + initialize).`
    );
    const rent = await connection.getMinimumBalanceForRentExemption(
      requiredAccountSize
    );
    // Group 1: fund the account's rent and allocate the header.
    groups.push([
      SystemProgram.transfer({
        fromPubkey: authority,
        toPubkey: metadata,
        lamports: rent,
      }),
      toLegacy(
        pm.getAllocateInstruction({
          buffer: common.metadata,
          authority: common.authority,
          program: common.program,
          programData: common.programData,
          seed: IDL_SEED,
        }),
        authority
      ),
    ]);
    // One Extend per transaction (each chunk is <= REALLOC_LIMIT).
    for (const length of extendChunks(dataLength)) {
      groups.push([extendIx(length)]);
    }
    // Final group: copy the buffer in and initialize the header. Neither
    // reallocs, so the caller can safely append close + upgrade here.
    groups.push([
      toLegacy(
        pm.getWriteInstruction({
          buffer: common.metadata,
          authority: common.authority,
          sourceBuffer: addr(idlBuffer),
          offset: 0,
        }),
        authority
      ),
      toLegacy(
        pm.getInitializeInstruction({
          ...common,
          system: addr(PROGRAM_METADATA_PROGRAM_ID),
          seed: IDL_SEED,
          ...IDL_DATA_SHAPE,
        }),
        authority
      ),
    ]);
  } else {
    const sizeDifference = requiredAccountSize - metadataAccount.data.length;
    console.log(
      `IDL metadata PDA ${metadata.toBase58()} exists; update flow (grow ${Math.max(
        sizeDifference,
        0
      )}B + set-data).`
    );
    if (sizeDifference > 0) {
      const [newRent, currentRent] = await Promise.all([
        connection.getMinimumBalanceForRentExemption(requiredAccountSize),
        connection.getMinimumBalanceForRentExemption(
          metadataAccount.data.length
        ),
      ]);
      groups.push([
        SystemProgram.transfer({
          fromPubkey: authority,
          toPubkey: metadata,
          lamports: newRent - currentRent,
        }),
      ]);
      for (const length of extendChunks(sizeDifference)) {
        groups.push([extendIx(length)]);
      }
    }
    // Final group: apply the buffer. SetData doesn't realloc (the account is
    // already grown), so close + upgrade can be appended here.
    groups.push([
      toLegacy(
        pm.getSetDataInstruction({
          ...common,
          buffer: addr(idlBuffer),
          ...IDL_DATA_SHAPE,
        }),
        authority
      ),
    ]);
  }

  return groups;
}

/**
 * Close a metadata buffer account, refunding rent to `destination`.
 * Used after the IDL is applied to recover the staged buffer's rent.
 */
export function createCloseBufferInstruction(
  buffer: PublicKey,
  authority: PublicKey,
  destination: PublicKey
): TransactionInstruction {
  return toLegacy(
    pm.getCloseInstruction({
      account: addr(buffer),
      authority: noopSigner(authority),
      destination: addr(destination),
    }),
    authority
  );
}

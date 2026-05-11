/**
 * Anchor 1.0 IDL flow: program-metadata-program
 * (https://github.com/solana-program/program-metadata).
 *
 * Anchor 1.0 removed the legacy IDL instructions baked into each program
 * (`IdlInstruction::Upgrade`, the `nJWGUMOK`-style discriminator) and moved
 * IDL storage out to a separate `ProgM6JCCvbYkfKqJYHePx4xxSUSqJp7rh8Lyv7nk7S`
 * program. This module hand-rolls the three instructions we need to apply a
 * pre-uploaded IDL buffer through Squads:
 *   - Initialize (disc 1): create the canonical metadata account for ("idl", program)
 *   - SetData    (disc 3): copy a buffer's contents into the metadata account
 *   - Close      (disc 6): close the now-spent buffer and refund rent to a destination
 *
 * Wire format matches @solana-program/program-metadata@0.5.1.
 */
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js'

export const PROGRAM_METADATA_PROGRAM_ID = new PublicKey(
  'ProgM6JCCvbYkfKqJYHePx4xxSUSqJp7rh8Lyv7nk7S'
)

const BPF_UPGRADE_LOADER_ID = new PublicKey(
  'BPFLoaderUpgradeab1e11111111111111111111111'
)

// program-metadata serializes seeds as fixed-size 16-byte utf8 (zero-padded).
const IDL_SEED = (() => {
  const buf = Buffer.alloc(16, 0)
  buf.write('idl', 0, 'utf8')
  return buf
})()

// program-metadata enum values (match Encoding/Compression/Format/DataSource in the dist js).
const ENCODING_UTF8 = 1
const COMPRESSION_ZLIB = 2
const FORMAT_JSON = 1
const DATA_SOURCE_DIRECT = 0

const DISC_INITIALIZE = 1
const DISC_SET_DATA = 3
const DISC_CLOSE = 6

/**
 * Canonical metadata PDA — managed by the program's upgrade authority.
 * seeds = [programId, "idl" padded to 16 bytes].
 */
export function findIdlMetadataPda(programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [programId.toBuffer(), IDL_SEED],
    PROGRAM_METADATA_PROGRAM_ID
  )
  return pda
}

/** Program data PDA under the BPF Upgradeable Loader. */
export function findProgramDataPda(programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_UPGRADE_LOADER_ID
  )
  return pda
}

/**
 * Initialize a canonical IDL metadata account.
 * Authority is the program's upgrade authority (the Squads vault, in our case).
 * Emits Initialize with `data: None` — actual content arrives via SetData(buffer).
 */
export function createInitializeIdlInstruction(
  programId: PublicKey,
  authority: PublicKey
): TransactionInstruction {
  const metadata = findIdlMetadataPda(programId)
  const programData = findProgramDataPda(programId)

  // data: disc(1) + seed(16) + encoding(1) + compression(1) + format(1) + dataSource(1)
  //     + Option<bytes>(no length prefix; None = no trailing bytes)
  const data = Buffer.concat([
    Buffer.from([DISC_INITIALIZE]),
    IDL_SEED,
    Buffer.from([ENCODING_UTF8, COMPRESSION_ZLIB, FORMAT_JSON, DATA_SOURCE_DIRECT]),
  ])

  return new TransactionInstruction({
    programId: PROGRAM_METADATA_PROGRAM_ID,
    keys: [
      { pubkey: metadata, isWritable: true, isSigner: false },
      { pubkey: authority, isWritable: false, isSigner: true },
      { pubkey: programId, isWritable: false, isSigner: false },
      { pubkey: programData, isWritable: false, isSigner: false },
      { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
    ],
    data,
  })
}

/**
 * Apply a pre-staged buffer to the canonical IDL metadata account.
 * Requires `Initialize` to have happened in a previous transaction (or
 * earlier in this same Squads transaction).
 */
export function createSetDataIdlInstruction(
  programId: PublicKey,
  buffer: PublicKey,
  authority: PublicKey
): TransactionInstruction {
  const metadata = findIdlMetadataPda(programId)
  const programData = findProgramDataPda(programId)

  // data: disc(1) + encoding(1) + compression(1) + format(1) + dataSource(1)
  //     + Option<bytes>(no length prefix; None when applying from buffer)
  const data = Buffer.from([
    DISC_SET_DATA,
    ENCODING_UTF8,
    COMPRESSION_ZLIB,
    FORMAT_JSON,
    DATA_SOURCE_DIRECT,
  ])

  return new TransactionInstruction({
    programId: PROGRAM_METADATA_PROGRAM_ID,
    keys: [
      { pubkey: metadata, isWritable: true, isSigner: false },
      { pubkey: authority, isWritable: false, isSigner: true },
      { pubkey: buffer, isWritable: true, isSigner: false },
      { pubkey: programId, isWritable: false, isSigner: false },
      { pubkey: programData, isWritable: false, isSigner: false },
    ],
    data,
  })
}

/**
 * Close a metadata buffer account, refunding rent to `destination`.
 * Used after SetData to recover the buffer's rent (~0.01 SOL for typical IDLs).
 */
export function createCloseBufferInstruction(
  buffer: PublicKey,
  authority: PublicKey,
  destination: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_METADATA_PROGRAM_ID,
    keys: [
      { pubkey: buffer, isWritable: true, isSigner: false },
      { pubkey: authority, isWritable: false, isSigner: true },
      // program / programData are optional; pass the program-metadata-program id
      // as the "None" sentinel (matches @solana-program/program-metadata wire).
      { pubkey: PROGRAM_METADATA_PROGRAM_ID, isWritable: false, isSigner: false },
      { pubkey: PROGRAM_METADATA_PROGRAM_ID, isWritable: false, isSigner: false },
      { pubkey: destination, isWritable: true, isSigner: false },
    ],
    data: Buffer.from([DISC_CLOSE]),
  })
}

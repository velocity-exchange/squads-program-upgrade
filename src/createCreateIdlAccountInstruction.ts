import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js'
import { idlAddress } from '@coral-xyz/anchor/dist/cjs/idl'

export async function createCreateIdlAccountInstruction(
  programId: PublicKey,
  authority: PublicKey,
  idlLen: bigint
) {
  const prefix = Buffer.from('0a69e9a778bcf440', 'hex')
  const ixn = Buffer.from('00', 'hex')
  const lengthBuf = Buffer.alloc(8)
  lengthBuf.writeBigUInt64LE(idlLen)
  const data = Buffer.concat([prefix.reverse(), ixn, lengthBuf])
  const idlAddr = await idlAddress(programId)

  const keys = [
    {
      pubkey: authority,
      isWritable: true,
      isSigner: true
    },
    {
      pubkey: idlAddr,
      isWritable: true,
      isSigner: false
    },
    {
      pubkey: PublicKey.findProgramAddressSync(
        [],
        programId
      )[0],
      isWritable: false,
      isSigner: false
    },
    {
      pubkey: SystemProgram.programId,
      isWritable: false,
      isSigner: false
    },
    {
      pubkey: programId,
      isWritable: false,
      isSigner: false
    }
  ]

  return new TransactionInstruction({
    keys,
    programId,
    data
  })
}

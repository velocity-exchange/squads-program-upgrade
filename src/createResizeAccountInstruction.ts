import {PublicKey, SystemProgram, TransactionInstruction} from '@solana/web3.js'
import {idlAddress} from '@coral-xyz/anchor/dist/cjs/idl'
import { BN } from '@coral-xyz/anchor'

export async function createResizeAccountInstruction(
  programId: PublicKey,
  payer: PublicKey
) {
  const prefix = Buffer.from('0a69e9a778bcf440', 'hex')
  const ixn = Buffer.from('06', 'hex')
  const lengthBuf = Buffer.alloc(8)
  lengthBuf.writeBigUInt64LE(new BN(10000))
  const data = Buffer.concat([prefix.reverse(), ixn, lengthBuf])
  const idlAddr = await idlAddress(programId)

  const keys = [
    {
      pubkey: idlAddr,
      isWritable: true,
      isSigner: false
    },
    {
      pubkey: payer,
      isWritable: true,
      isSigner: true
    },
    {
      pubkey: SystemProgram.programId,
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

import * as core from '@actions/core'
import { createProgramUpgrade } from './createProgramUpgrade'
import { keypairFrom, publicKeyFrom } from './utils'

async function run(): Promise<void> {
  try {
    const networkUrl: string = core.getInput('network-url')
    const programMultisig: string = core.getInput('program-multisig')
    const programId: string = core.getInput('program-id')
    const buffer: string = core.getInput('buffer')
    const spillAddress: string = core.getInput('spill-address')
    const authority: string = core.getInput('authority')
    const name: string = core.getInput('name')
    const keypair: string = core.getInput('keypair')
    const idlBuffer: string = core.getInput('idl-buffer')

    core.debug(`start: ${new Date().toLocaleString()}`)
    core.debug(`networkUrl: ${networkUrl}`)
    core.debug(`programMultisig: ${programMultisig}`)
    core.debug(`programId: ${programId}`)
    core.debug(`buffer: ${buffer}`)
    core.debug(`spillAddress: ${spillAddress}`)
    core.debug(`authority: ${authority}`)
    core.debug(`name: ${name}`)
    core.debug(`idlBuffer: ${idlBuffer}`)
    core.debug(`keypair: **********`)

    const wallet = keypairFrom(keypair, 'keypair')
    // spill-address is optional: reclaimed buffer rent defaults to the
    // proposer's own pubkey when no explicit recipient is provided.
    const spill = spillAddress
      ? publicKeyFrom(spillAddress, 'spillAddress')
      : wallet.publicKey

    await createProgramUpgrade({
      multisig: publicKeyFrom(programMultisig, 'programMultisig'),
      programId: publicKeyFrom(programId, 'programId'),
      buffer: publicKeyFrom(buffer, 'buffer'),
      idlBuffer: idlBuffer ? publicKeyFrom(idlBuffer, 'idl-buffer') : undefined,
      spill,
      authority: publicKeyFrom(authority, 'authority'),
      wallet,
      networkUrl,
      name,
    })
    console.log('Program upgrade proposal created successfully')
  } catch (error) {
    console.error('Error during program upgrade:', error)
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()

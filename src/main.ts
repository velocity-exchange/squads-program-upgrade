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
    const authorityIndex: string = core.getInput('authority-index')

    core.debug(`start: ${new Date().toLocaleString()}`)
    core.debug(`networkUrl: ${networkUrl}`)
    core.debug(`programMultisig: ${programMultisig}`)
    core.debug(`programId: ${programId}`)
    core.debug(`buffer: ${buffer}`)
    core.debug(`spillAddress: ${spillAddress}`)
    core.debug(`authority: ${authority}`)
    core.debug(`name: ${name}`)
    core.debug(`idlBuffer: ${idlBuffer}`)
    core.debug(`authorityIndex: ${authorityIndex}`)
    core.debug(`keypair: **********`)

    await createProgramUpgrade({
      multisig: publicKeyFrom(programMultisig, 'programMultisig'),
      programId: publicKeyFrom(programId, 'programId'),
      buffer: publicKeyFrom(buffer, 'buffer'),
      idlBuffer: publicKeyFrom(idlBuffer, 'idl-buffer'),
      spill: publicKeyFrom(spillAddress, 'spillAddress'),
      authority: publicKeyFrom(authority, 'authority'),
      wallet: keypairFrom(keypair, 'keypair'),
      networkUrl
    })
    console.log('Program upgrade completed successfully')
  } catch (error) {
    console.error('Error during program upgrade:', error)
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()

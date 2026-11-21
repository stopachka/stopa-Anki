import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Build once when changing the inference engine; deploy the checked-in WASM.
// Requires rustup target add wasm32-unknown-unknown. No crates or npm dependencies.
const source = fileURLToPath(new URL('./runtime.rs', import.meta.url))
const project = fileURLToPath(new URL('../../', import.meta.url))
const output = fileURLToPath(new URL('../../public/models/rwkv/runtime-v1.wasm', import.meta.url))
execFileSync('rustc', [
  source, '--edition=2021', '--crate-type=cdylib', '--target=wasm32-unknown-unknown',
  '--remap-path-prefix', `${project}=`,
  '-C', 'opt-level=3', '-C', 'target-feature=+simd128', '-C', 'lto=fat',
  '-C', 'panic=abort', '-C', 'strip=symbols', '-C', 'codegen-units=1',
  '-C', 'link-arg=--max-memory=536870912', '-o', output,
], { stdio: 'inherit' })
console.log(`Built ${output}`)
const weightFile = 'big-sm99-682ba1ff.weights.bin'
const weightsPath = fileURLToPath(new URL(`../../public/models/rwkv/${weightFile}`, import.meta.url))
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const weightsSha256 = hash(weightsPath)
if (weightsSha256 !== '682ba1ff207c51af7de5e2abeb25593362aa706b292cbcc338a1591fad0d935c') throw new Error('The Big SM99 weights differ from the pinned release.')
const manifest = { wasmSha256: hash(output), weightsSha256, wasmFile: 'runtime-v1.wasm', weightsFile: weightFile }
writeFileSync(fileURLToPath(new URL('../../src/lib/rwkv/runtime-assets.json', import.meta.url)), `${JSON.stringify(manifest, null, 2)}\n`)

/** Browser CPU inference for the pretrained Big SM99 Instant model. */
export type RwkvEntities = readonly [string | number, string | number, string | number, string | number, string | number]
export interface RuntimePrediction { recall: number; ratings: [number, number, number, number] }

interface RuntimeExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory
  rwkv_alloc(size: number): number
  rwkv_free(pointer: number, size: number): void
  rwkv_create(pointer: number, size: number, stateBits: number): number
  rwkv_drop(engine: number): void
  rwkv_reset(engine: number): void
  rwkv_step(engine: number, features: number, ids: number, commit: number, output: number): number
  rwkv_state_bytes(engine: number): number
}

/** One instance per signed-in user's worker. Weights are immutable; review state is local. */
export class RwkvRuntime {
  private wasm: RuntimeExports
  private engine: number
  private input: number
  private entities: number
  private output: number
  private keys = Array.from({ length: 5 }, () => new Map<string | number, number>())

  private constructor(wasm: RuntimeExports, engine: number) {
    this.wasm = wasm
    this.engine = engine
    this.input = wasm.rwkv_alloc(92 * 4)
    this.entities = wasm.rwkv_alloc(5 * 4)
    this.output = wasm.rwkv_alloc(5 * 4)
  }

  static async create(weights: ArrayBuffer, wasmBytes: ArrayBuffer, stateBits: 0 | 8 = 0): Promise<RwkvRuntime> {
    const { instance } = await WebAssembly.instantiate(wasmBytes, {})
    const wasm = instance.exports as RuntimeExports
    const buffer = wasm.rwkv_alloc(weights.byteLength)
    let engine = 0
    try {
      new Uint8Array(wasm.memory.buffer, buffer, weights.byteLength).set(new Uint8Array(weights))
      engine = wasm.rwkv_create(buffer, weights.byteLength, stateBits)
      if (!engine) throw new Error('Unable to initialize the Big SM99 model.')
    } finally {
      wasm.rwkv_free(buffer, weights.byteLength)
    }
    return new RwkvRuntime(wasm, engine)
  }

  evaluate(features: Float32Array, entities: RwkvEntities, commit: boolean): RuntimePrediction {
    this.assertOpen()
    if (features.length !== 92 || !features.every(Number.isFinite)) throw new Error('RWKV expects 92 finite features.')
    if (entities.length !== 5) throw new Error('RWKV expects five entity IDs.')
    const ids = entities.map((entity, scope) => {
      if (typeof entity !== 'string' && typeof entity !== 'number') throw new Error('Invalid RWKV entity ID.')
      if (typeof entity === 'number' && !Number.isFinite(entity)) throw new Error('Invalid RWKV entity ID.')
      const bank = this.keys[scope]
      let id = bank.get(entity)
      if (id === undefined) { id = bank.size + 1; bank.set(entity, id) }
      return id
    })
    new Float32Array(this.wasm.memory.buffer, this.input, 92).set(features)
    new Uint32Array(this.wasm.memory.buffer, this.entities, 5).set(ids)
    if (!this.wasm.rwkv_step(this.engine, this.input, this.entities, Number(commit), this.output)) {
      throw new Error('The RWKV model produced an invalid prediction.')
    }
    // memory may grow during a step, so construct views after the call.
    const result = new Float32Array(this.wasm.memory.buffer, this.output, 5)
    return { recall: result[0], ratings: [result[1], result[2], result[3], result[4]] }
  }

  /** Reference API: a query uses skip=true and must never update recurrent state. */
  step(features: Float32Array, entities: RwkvEntities, skip: boolean): RuntimePrediction {
    return this.evaluate(features, entities, !skip)
  }

  reset(): void {
    this.assertOpen()
    this.wasm.rwkv_reset(this.engine)
    this.keys.forEach((bank) => bank.clear())
  }

  clear(): void { this.reset() }

  get stateBytes(): number { this.assertOpen(); return this.wasm.rwkv_state_bytes(this.engine) }
  get memoryBytes(): number { this.assertOpen(); return this.wasm.memory.buffer.byteLength }

  dispose(): void {
    if (!this.engine) return
    this.wasm.rwkv_drop(this.engine)
    this.wasm.rwkv_free(this.input, 92 * 4)
    this.wasm.rwkv_free(this.entities, 5 * 4)
    this.wasm.rwkv_free(this.output, 5 * 4)
    this.engine = 0
    this.keys.forEach((bank) => bank.clear())
  }

  private assertOpen(): void { if (!this.engine) throw new Error('The RWKV runtime is closed.') }
}

export async function createRwkvRuntime(options: {
  weightsBytes: ArrayBuffer | ArrayBufferView
  wasmBytes: ArrayBuffer | ArrayBufferView
  stateBits?: 0 | 8
}): Promise<RwkvRuntime> {
  const buffer = (bytes: ArrayBuffer | ArrayBufferView): ArrayBuffer => {
    if (bytes instanceof ArrayBuffer) return bytes
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice().buffer
  }
  return RwkvRuntime.create(buffer(options.weightsBytes), buffer(options.wasmBytes), options.stateBits)
}

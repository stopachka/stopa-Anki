import { loadModelAssets } from './assets.ts';
import { RwkvController } from './controller.ts';
import { RwkvRuntime } from './runtime.ts';
import type { ReviewRecord, WordIdentity } from './types.ts';

type Request = { id: number } & (
  { kind: 'sync'; words: WordIdentity[]; reviews: ReviewRecord[] } |
  { kind: 'rank'; words: WordIdentity[]; now: number }
);

// Keep the worker isolated from the UI and process messages in order. Async
// model downloads must not allow a rank call to overtake a history replay.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage(message: unknown): void;
};
let controller: Promise<RwkvController> | undefined;
let queue = Promise.resolve();

function getController(): Promise<RwkvController> {
  if (!controller) controller = loadModelAssets()
    .then(async ({ weights, wasm }) => new RwkvController(await RwkvRuntime.create(weights, wasm, 0)))
    .catch(error => { controller = undefined; throw error; });
  return controller;
}

scope.onmessage = event => {
  const request = event.data;
  queue = queue.then(async () => {
    try {
      const model = await getController();
      const result = request.kind === 'sync'
        ? model.sync(request.words, request.reviews)
        : model.rank(request.words, request.now);
      scope.postMessage({ id: request.id, result });
    } catch (error) {
      scope.postMessage({ id: request.id, error: error instanceof Error ? error.message : 'Couldn’t prepare the study model. Please try again.' });
    }
  });
};

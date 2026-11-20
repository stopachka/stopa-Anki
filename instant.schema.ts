import { i } from '@instantdb/react';
import type { StoredCard, StoredReviewLog } from './src/lib/card-codec';

const schema = i.schema({
  entities: {
    $files: i.entity({ path: i.string().unique().indexed(), url: i.string() }),
    $streams: i.entity({ abortReason: i.string().optional(), clientId: i.string().unique().indexed(), done: i.boolean().optional(), size: i.number().optional() }),
    $users: i.entity({ email: i.string().unique().indexed().optional(), imageURL: i.string().optional(), type: i.string().optional() }),
    hanziProgress: i.entity({
      key: i.string().unique().indexed(),
      ownerId: i.string().indexed(),
      wordId: i.string(),
      book: i.number(),
      card: i.json<StoredCard>(),
      updatedAt: i.number(),
    }),
    hanziReviews: i.entity({
      ownerId: i.string().indexed(),
      wordId: i.string(),
      book: i.number(),
      rating: i.number(),
      reviewedAt: i.number().indexed(),
      log: i.json<StoredReviewLog>(),
    }),
    hanziSettings: i.entity({
      ownerId: i.string().unique().indexed(),
      dailyNewLimit: i.number(),
      updatedAt: i.number(),
    }),
  },
  links: {
    $streams$files: {
      forward: { on: '$streams', has: 'many', label: '$files' },
      reverse: { on: '$files', has: 'one', label: '$stream', onDelete: 'cascade' },
    },
    $usersLinkedPrimaryUser: {
      forward: { on: '$users', has: 'one', label: 'linkedPrimaryUser', onDelete: 'cascade' },
      reverse: { on: '$users', has: 'many', label: 'linkedGuestUsers' },
    },
  },
});

export type AppSchema = typeof schema;
export default schema;

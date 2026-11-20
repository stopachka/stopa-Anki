import type { InstantRules } from '@instantdb/react';

const rules = {
  $default: { allow: { $default: 'false' } },
  attrs: { allow: { create: 'false' } },
  // This create rule applies to verified auth signup, not client transactions.
  $users: { allow: { view: 'auth.id != null && auth.id == data.id', create: 'true', update: 'false', delete: 'false' } },
  hanziProgress: {
    bind: {
      isOwner: 'auth.id != null && auth.id == data.ownerId',
      isStillOwner: 'auth.id != null && auth.id == newData.ownerId',
    },
    allow: {
      view: 'isOwner',
      create: "isOwner && data.key == auth.id + ':' + data.wordId",
      update: 'isOwner && isStillOwner && newData.key == data.key && newData.wordId == data.wordId',
      delete: 'isOwner',
    },
  },
  hanziReviews: {
    bind: { isOwner: 'auth.id != null && auth.id == data.ownerId' },
    allow: { view: 'isOwner', create: 'isOwner', update: 'false', delete: 'isOwner' },
  },
} satisfies InstantRules;

export default rules;

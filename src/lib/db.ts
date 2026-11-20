import { init } from '@instantdb/react';
import schema from '../../instant.schema';

// Public application identifier. Admin credentials are never part of this app.
export const INSTANT_APP_ID = 'a38c70a0-3447-43ec-9692-0750d2089bc6';
export const db = init({ appId: INSTANT_APP_ID, schema, devtool: false });

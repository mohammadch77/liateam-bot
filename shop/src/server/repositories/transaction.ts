import 'server-only';

/**
 * Unit of work for services: they may group repository calls in one transaction without touching the db layer
 * directly. Pass the `db` handed to the callback into each repository call that must be part of it.
 */
export { withTransaction, type Queryable } from '@/lib/db';

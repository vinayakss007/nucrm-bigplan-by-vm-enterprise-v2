// fixture (#3280): armed through the helper rather than by hand.
import { withSecurityContext } from '@/lib/db/rls';
import { dealStages } from '@/drizzle/schema';

export const stages = () => withSecurityContext((tx) => tx.select().from(dealStages));

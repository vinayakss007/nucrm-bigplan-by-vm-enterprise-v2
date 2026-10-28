// fixture (#3280): armed through the read-only session helper, which names the context
// it opens the transaction with.
import { withReadonlySession } from './lib/readonly-db.mts';

export const stages = () =>
  withReadonlySession({ superAdmin: true }, (client) => client.query('SELECT count(*) FROM deal_stages'));

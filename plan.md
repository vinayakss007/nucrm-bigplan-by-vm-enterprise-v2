1. **Analyze the Optimization Opportunity:** The `app/api/tenant/leads/assign/route.ts` file has an N+1 query problem when assigning leads. It loops through `contact_ids` and executes an `INSERT INTO lead_assignments` query for each contact. This requires a roundtrip to the DB for each item, which is inefficient.
2. **Establish a Baseline:** I have created a benchmark script `scripts/benchmark-assign.ts` that simulates this N+1 query and compares it with a batch insert using `sql.join`. The benchmark showed a 99.4% improvement for 1000 contacts.
3. **Implement Optimization:** I will refactor the N+1 `INSERT` loop in `app/api/tenant/leads/assign/route.ts` to use a chunked batch strategy.
   - Guard the `db.execute` with an empty array check (`contact_ids.length > 0`).
   - Group the `contact_ids` into chunks of 1000.
   - For each chunk, map to an array of `sql` templates representing each row's values.
   - Use `sql.join` to stitch them into a single `db.execute(sql\`INSERT INTO ... VALUES \${sql.join(..., sql\`, \`)}\`)`.
   - Wrap the bulk insert in `.catch(err => logError(...))` to maintain the exact same functionality, but chunked.
4. **Verify Correctness:** Run format and lint checks (`npm run check`) and full test suite (`bash postman/full-test-suite.sh`). Measure baseline vs. post-optimization performance again if applicable, although our benchmark script already confirms the theoretical win.
5. **Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.**
6. **Submit PR.**

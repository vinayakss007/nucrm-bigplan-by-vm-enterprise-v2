import { sql } from 'drizzle-orm';
import { performance } from 'perf_hooks';

// Simulate Drizzle DB object with execute function
const mockDb = {
  execute: async (query: any) => {
    // simulate network latency ~1ms per query
    return new Promise(resolve => setTimeout(resolve, 1));
  }
};

async function testLoop(contact_ids: string[]) {
  const start = performance.now();
  for (const cid of contact_ids) {
    await mockDb.execute(sql`
      INSERT INTO public.lead_assignments (tenant_id, contact_id, assigned_to, assigned_by, reason)
      VALUES (${'t-1'}, ${cid}, ${'u-2'}, ${'u-1'}, ${'reason'})
    `);
  }
  return performance.now() - start;
}

async function testBatch(contact_ids: string[]) {
  const start = performance.now();

  // Create an array of SQL values
  if (contact_ids.length > 0) {
    // Chunking by 1000 to be safe with postgres parameters
    const CHUNK_SIZE = 1000;
    for (let i = 0; i < contact_ids.length; i += CHUNK_SIZE) {
      const chunk = contact_ids.slice(i, i + CHUNK_SIZE);
      const values = chunk.map(cid => sql`(${'t-1'}, ${cid}, ${'u-2'}, ${'u-1'}, ${'reason'})`);

      await mockDb.execute(sql`
        INSERT INTO public.lead_assignments (tenant_id, contact_id, assigned_to, assigned_by, reason)
        VALUES ${sql.join(values, sql`, `)}
      `);
    }
  }
  return performance.now() - start;
}

async function run() {
  const contact_ids = Array.from({ length: 1000 }, (_, i) => `c-${i}`);

  console.log(`Running baseline (N+1)...`);
  const timeN1 = await testLoop(contact_ids);

  console.log(`Running optimized (Batch)...`);
  const timeBatch = await testBatch(contact_ids);

  console.log(`Baseline time: ${timeN1.toFixed(2)}ms`);
  console.log(`Batch time: ${timeBatch.toFixed(2)}ms`);
  console.log(`Improvement: ${((timeN1 - timeBatch) / timeN1 * 100).toFixed(2)}%`);
}

run().catch(console.error);

const NUM_ITEMS = 10000;

const justExpired = Array.from({ length: NUM_ITEMS }, (_, i) => ({
  id: `tenant_${i}`,
  name: `Tenant ${i}`,
  billingEmail: null,
  ownerId: `user_${i}`
}));

const owners = Array.from({ length: NUM_ITEMS }, (_, i) => ({
  id: `tenant_${i}`,
  ownerEmail: `user${i}@example.com`,
  ownerName: `User ${i}`
}));

// Baseline
console.time('Array .find');
for (const t of justExpired) {
  const owner = owners.find(o => o.id === t.id);
  const to = t.billingEmail || owner?.ownerEmail;
}
console.timeEnd('Array .find');

// Optimized
console.time('Map .get');
const ownersMap = new Map(owners.map(o => [o.id, o]));
for (const t of justExpired) {
  const owner = ownersMap.get(t.id);
  const to = t.billingEmail || owner?.ownerEmail;
}
console.timeEnd('Map .get');

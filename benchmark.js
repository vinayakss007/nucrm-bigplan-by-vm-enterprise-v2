const iterations = 1000;
const start = performance.now();
let count = 0;
for (let i = 0; i < iterations; i++) {
  count += 1;
}
const end = performance.now();
console.log(`Execution time: ${end - start} ms`);

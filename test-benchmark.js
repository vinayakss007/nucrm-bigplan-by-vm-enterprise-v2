const start = Date.now();
async function uploadMock(file, delay) {
    return new Promise(resolve => setTimeout(resolve, delay));
}

async function seq(files) {
    for (const f of files) {
        await uploadMock(f, 100);
    }
}

async function conc(files) {
    await Promise.all(files.map(f => uploadMock(f, 100)));
}

async function run() {
    const files = Array(50).fill('f');
    let s = Date.now();
    await seq(files);
    console.log("Sequential:", Date.now() - s, "ms");

    s = Date.now();
    await conc(files);
    console.log("Concurrent:", Date.now() - s, "ms");
}
run();

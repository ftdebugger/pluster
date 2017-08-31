let app = require('express')();

let MEMORY_LEAK = [];
let MEMORY_LEAK_PAYLOAD = [];

app.use(function (req, res) {
    let MEMORY = JSON.stringify(MEMORY_LEAK);

    MEMORY_LEAK_PAYLOAD.push(1);
    MEMORY_LEAK.push(MEMORY_LEAK_PAYLOAD.slice());

    //console.log(process.memoryUsage().heapUsed);

    setTimeout(() => {
        res.json({ok: 1});
        MEMORY.slice(10, -10);
    }, 100);
});

let server = app.listen(3000, function () {
    console.log('Listen on 3000');
});

let pluster = require('../index');
pluster.waitDisconnect(() => {
    server.on('close', () => {
        setTimeout(() => process.exit(0), 1000);
    });

    server.close();
});

let cluster = require('cluster');
let {join} = require('path');
let http = require('http');

let {Config} = require('../Config');
let {Master} = require('../Master');
let {Worker} = require('../Worker');

process.env.PLUSTER = 'true';

let config = new Config([
    join(__dirname, 'pluster.config.js')
]);

if (cluster.isMaster) {
    let master = new Master(config).start(),
        times = [],
        success = 0,
        error = 0;

    let agent = new http.Agent({
        keepAlive: true
    });

    function request() {
        let options = {
            hostname: 'localhost',
            port: 3000,
            //agent
        };

        return new Promise((resolve, reject) => {
            http
                .get(options, (response) => {
                    let {statusCode} = response,
                        resultData = '';

                    response.setEncoding('utf8');

                    if (statusCode !== 200) {
                        reject(new Error(`Response error ${statusCode}`));
                        response.resume();
                    } else {
                        response.on('data', data => {
                            resultData += data;
                        });

                        response.on('end', () => {
                            if (resultData !== '{"ok":1}') {
                                reject(new Error(`Incorrect data: ${resultData}`));
                            } else {
                                resolve();
                            }
                        });
                    }
                })
                .on('error', (error) => reject(error));
        });
    }

    function doRequest() {
        let time = Date.now();

        return request()
            .then(() => success++)
            .catch((err) => {
                console.log(err);
                error++;
            })
            .then(() => times.push(Date.now() - time));
    }

    function runSuite(rest = 1000) {
        if (rest) {
            return doRequest().then(() => runSuite(rest - 1));
        }
    }

    setTimeout(() => {
        console.log('start');
        let promise = Promise.all([
            runSuite(),
            runSuite(),
            runSuite(),
            runSuite(),
            runSuite(),
            runSuite(),
            runSuite(),
            runSuite(),
            runSuite(),
            runSuite(),
            runSuite()
        ]);

        promise.then(() => {
            console.log('complete');

            let sum = times.reduce((a, b) => a + b, 0);
            let max = Math.max(...times);
            let min = Math.min(...times);

            console.log('RESULT: %d / %d', success, error);

            console.log('MIN: ', min);
            console.log('AVG: ', sum / times.length);
            console.log('MAX: ', max);
        });
    }, 2000);
} else {
    new Worker(config).start();
}

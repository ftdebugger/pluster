let cluster = require('cluster');

let {Config} = require('./Config');
let {Master} = require('./Master');
let {Worker} = require('./Worker');

let config = new Config(process.argv);

if (cluster.isMaster) {
    module.exports = new Master(config);
} else {
    module.exports = new Worker(config);
}

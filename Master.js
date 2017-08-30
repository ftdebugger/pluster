let cluster = require('cluster');
let EventEmitter = require('events');
let fs = require('fs');

let {Worker} = require('./Worker');

class Master extends EventEmitter {

    constructor(config) {
        super();

        this.config = config;
        this.workers = [];
        this.pool = [];
        this.disconnectQueue = [];
        this.disconnectProgress = false;

        if (this.config.enabled) {
            process.chdir(this.config.cwd);

            this.initPlugins();
        }
    }

    /**
     * Start plugins
     */
    initPlugins() {
        this.config.getPlugins().forEach(plugin => {
            if (plugin.master) {
                plugin.master(this);
            }
        });
    }

    start() {
        let port = this.config.env.port;

        if (port && fs.existsSync(port)) {
            fs.unlinkSync(port);
        }

        process.on('SIGTERM', () => {
            this.terminate = true;

            console.log('SIGTERM');

            this.workers.forEach(worker => {
                worker.disconnect();

                setTimeout(() => worker.kill(), 5000);
            });

            setTimeout(() => process.exit(0), 5001);
        });

        this.listen();
        this.startWorkers();

        return this;
    }

    listen() {

    }

    startWorkers() {
        let {workers} = this.config;

        while (this.workers.length < workers && !this.terminate) {
            this.startWorker();
        }
    }

    startWorker() {
        let worker = this._getWorkerFromPool() || this._createWorker();

        this.workers.push(worker);
        worker.fork();
    }

    planDisconnect(callback) {
        this._log('plan disconnect');

        this.disconnectQueue.push(callback);

        if (!this.disconnectProgress) {
            this.disconnectNext();
        }
    }

    /**
     * Disconnect next worker
     */
    disconnectNext() {
        this._log('disconnect next');

        if (this.disconnectQueue.length) {
            this.disconnectProgress = true;

            // Disconnect next worker in queue
            this.disconnectQueue.shift()();
        } else {
            this.disconnectProgress = false;
        }
    }

    /**
     * @returns {Worker}
     * @private
     */
    _getWorkerFromPool() {
        for (let index = 0; index < this.pool.length; index++) {
            let worker = this.pool[index];

            if (!worker.started) {
                this.pool = this._removeWorkerFrom(this.pool, worker);

                return worker;
            }
        }
    }

    /**
     * @returns {Worker}
     * @private
     */
    _createWorker() {
        let worker = new Worker(this.config, this);

        worker.on('exit', () => {
            this._log('worker exit');

            // Do not fork, when it in pool
            if (this.pool.indexOf(worker) === -1) {
                worker.fork();
            }

            // If we have disconnect queue
            this.disconnectNext();
        });

        worker.on('rotate', () => {
            this.pool.push(worker);
            this._removeWorker(worker);
            this.startWorkers();
        });

        worker.on('message', (data) => {
            this.emit('message', worker, data);
        });

        return worker;
    }

    /**
     * @param {Worker} worker
     * @private
     */
    _removeWorker(worker) {
        this.workers = this._removeWorkerFrom(this.workers, worker);
    }

    /**
     * @param {Worker[]} workers
     * @param {Worker} worker
     * @private
     */
    _removeWorkerFrom(workers, worker) {
        return workers.filter(_worker => _worker !== worker);
    }

    /**
     * @param {function} callback
     * @returns {*[]}
     */
    map(callback) {
        return this.workers.map(callback);
    }

    /**
     * @param {function} callback
     * @returns {*[]}
     */
    forEach(callback) {
        this.workers.forEach(callback);
    }

    /**
     * @param {string} handleEvent
     * @param {function} callback
     */
    requestHandler(handleEvent, callback) {
        this.on('message', (worker, {id, event, payload}) => {
            if (event === handleEvent) {
                Promise.resolve(callback(payload))
                    .then((payload) => {
                        worker.send({id, event, payload});
                    })
                    .catch(err => {
                        worker.send({id, event, error: err.message});
                    });
            }
        });
    }

    /**
     * @param {string} message
     * @param {string[]} args
     * @private
     */
    _log(message, ...args) {
        console.log(
            '[%s] [master] [w%d/p%d/d%d] ' + message,
            new Date().toISOString(),
            this.workers.length,
            this.pool.length,
            this.disconnectQueue.length,
            ...args
        );
    }
}

module.exports.Master = Master;

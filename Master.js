let EventEmitter = require('events');
let fs = require('fs');

let {Worker} = require('./Worker');

class Master extends EventEmitter {

    constructor(config) {
        super();

        this.config = config;
        this.workers = [];
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
        process.on('SIGTERM', () => {
            this.terminate = true;

            this._log('SIGTERM');

            this.workers.forEach(worker => worker.shutdown());

            // Kill process after timeout
            setTimeout(() => process.exit(0), this.config.killOnSigTerm + 1);
        });

        this.startWorkers();

        return this;
    }

    /**
     * Start enough workers
     */
    startWorkers() {
        let {workers} = this.config;

        while (this.workers.length < workers && !this.terminate) {
            this.startWorker();
        }
    }

    /**
     * Start single worker
     */
    startWorker() {
        this._log('start worker');

        let worker = this._createWorker();

        this.workers.push(worker);

        worker.fork();
    }

    /**
     * @param worker
     */
    planDisconnect(worker) {
        if (this.terminate) {
            worker.shutdown();
        } else {
            this._log('plan disconnect');

            this.disconnectQueue.push(worker);

            if (!this.disconnectProgress) {
                this.disconnectNext();
            }
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
            this.disconnectQueue.shift().disconnect();
        } else {
            this.disconnectProgress = false;
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

            this._removeWorker(worker);

            if (!this.terminate && !worker.rotated) {
                this.startWorker();
            }

            this.disconnectNext();
        });

        worker.on('rotate', () => {
            this._log('worker rotate');

            worker.rotated = true;

            this.startWorker();

            setTimeout(() => {
                this.planDisconnect(worker);
            }, this.config.disconnectHold);
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
        return this.workers
            .filter(this._accept, this)
            .map(callback);
    }

    /**
     * @param {function} callback
     * @returns {*[]}
     */
    forEach(callback) {
        this.workers
            .filter(this._accept, this)
            .forEach(callback);
    }

    /**
     * Return if worker is suitable for messaging
     * @param worker
     * @returns {boolean}
     */
    _accept(worker) {
        let subWorker = worker.worker;

        if (!subWorker || subWorker.isDead() || !subWorker.isConnected()) {
            return false;
        }

        return worker.started && !worker.rotated;
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
            '[%s] [master] [w%d/d%d] ' + message,
            new Date().toISOString(),
            this.workers.length,
            this.disconnectQueue.length,
            ...args
        );
    }
}

module.exports.Master = Master;

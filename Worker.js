let cluster = require('cluster');
let EventEmitter = require('events');
let {resolve} = require('path');

const SIGNAL_OUT_OF_MEMORY = 'PLUSTER_SIGNAL_OUT_OF_MEMORY';
const TIMEOUT = 5000;

let uniqueId = 0;

class Worker extends EventEmitter {

    constructor(config) {
        super();

        this.config = config;
    }

    fork() {
        if (!cluster.isMaster) {
            throw new Error('fork must be called on master only');
        }

        if (this.started) {
            this._log('Worker already started');

            return;
        }

        this._log('fork');

        this.started = true;
        this.worker = cluster.fork(this.config.env);
        this._listen();
    }

    _listen() {
        let onExit = () => {
            this._log('exit signal');

            this._exit();
        };

        let onMessage = (data) => {
            if (data && data.event === SIGNAL_OUT_OF_MEMORY) {
                this.disconnect();
            }

            this.emit('message', data);
        };

        let onDisconnect = () => {
            if (!this.started || this._disconnecting) {
                return;
            }

            this._log('disconnect signal');

            this._exit();
        };

        let onClose = () => {
            this._log('close signal');
        };

        this.worker.on('exit', onExit);
        this.worker.on('message', onMessage);
        this.worker.on('disconnect', onDisconnect);
        this.worker.on('close', onClose);
    }

    _exit() {
        this.worker.removeAllListeners();
        this.worker.kill();
        this.worker = null;
        this.started = false;

        this.emit('exit');
    }

    /**
     * Start in worker tread
     */
    start() {
        if (cluster.isMaster) {
            throw new Error('Start can be called only on slave node');
        }

        // Use in not pluster
        if (!this.config.enabled) {
            return;
        }

        this._log('start');

        // Start APP
        this._startMemoryMonitoring();

        process.chdir(this.config.cwd);

        this.initPlugins();

        require(resolve(this.config.app));
    }

    /**
     * Start plugins
     */
    initPlugins() {
        this.config.getPlugins().forEach(plugin => {
            if (plugin.worker) {
                plugin.worker(this);
            }
        });
    }

    /**
     * Start disconnect
     */
    disconnect() {
        if (cluster.isMaster) {
            if (!this._disconnecting) {
                this._disconnecting = true;

                this._log('start disconnect');

                this.emit('rotate');

                this.worker.disconnect();

                setTimeout(() => {
                    this._disconnecting = false;
                    this._exit();
                }, this.config.killOnDisconnectTimeout);
            }
        } else {
            this._log('send out of memory');

            this.send({
                event: SIGNAL_OUT_OF_MEMORY
            });
        }
    }

    /**
     * Check memory usage with interval
     *
     * @private
     */
    _startMemoryMonitoring() {
        this.interval = setInterval(() => this._checkMemory(), this.config.memoryCheckInterval);
    }

    /**
     * Check memory usage
     *
     * @private
     */
    _checkMemory() {
        let heapUsed = this._memory();

        // this._log('head used [%d]', heapUsed);

        if (heapUsed > this.config.maxAllowedMemory) {
            this.disconnect();
        }
    }

    _log(message, ...args) {
        if (cluster.isMaster) {
            if (this.worker) {
                console.log('[master worker(%d)] ' + message, this.worker.process.pid, ...args);
            } else {
                console.log('[master %d] ' + message, this._memory(), ...args);
            }
        } else {
            console.log('[worker %d] ' + message, process.pid, ...args);
        }
    }

    _memory() {
        return process.memoryUsage().heapUsed;
    }

    /**
     * Send data
     *
     * @param data
     */
    send(data) {
        try {
            if (cluster.isMaster) {
                this.worker.send(data);
            } else {
                process.send(data);
            }
        } catch (err) {
            this._log('message sent failed. Reason: %s', err.message);
        }
    }

    /**
     * @param {string} event
     * @param {{}} payload
     *
     * @returns {Promise<{}>}
     */
    request(event, payload = null) {
        if (cluster.isMaster) {
            return this._request(this.worker, 'master-' + uniqueId++, event, payload);
        } else {
            return this._request(process, process.pid + '-' + uniqueId++, event, payload);
        }
    }

    /**
     * @param {EventEmitter} target
     * @param {string} id
     * @param {string} event
     * @param {{}} payload
     *
     * @returns {Promise}
     * @private
     */
    _request(target, id, event, payload) {
        return new Promise((resolve, reject) => {
            let timeout = setTimeout(() => {
                target.removeListener('message', handler);

                reject(new Error('timeout'));
            }, TIMEOUT);


            let handler = (message) => {
                if (message.event === event && message.id === id) {
                    clearTimeout(timeout);
                    target.removeListener('message', handler);
                    resolve(message.payload);
                }
            };

            target.on('message', handler);
            target.send({id, event, payload});
        });
    }

    /**
     * @param {string} handleEvent
     * @param {function} callback
     */
    requestHandler(handleEvent, callback) {
        let target = cluster.isMaster ?
            this.worker :
            process;

        target.on('message', ({id, event, payload}) => {
            if (event === handleEvent) {
                Promise.resolve(callback(payload))
                    .then((payload) => {
                        this.send({id, event, payload});
                    })
                    .catch(err => {
                        this.send({id, event, error: err.message});
                    });
            }
        });
    }

    /**
     * Kill worker
     */
    kill() {
        this._exit();
    }
}

module.exports.Worker = Worker;

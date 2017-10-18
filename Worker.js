let cluster = require('cluster');
let EventEmitter = require('events');
let {resolve} = require('path');

const SIGNAL_OUT_OF_MEMORY = 'PLUSTER_SIGNAL_OUT_OF_MEMORY';
const SIGNAL_DISCONNECT = 'PLUSTER_SIGNAL_DISCONNECT';
const TIMEOUT = 5000;

let uniqueId = 0;

class Worker extends EventEmitter {

    constructor(config, master) {
        super();

        this.master = master;
        this.config = config;
    }

    /**
     * Start worker from master
     */
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

    /**
     * Listen child process messages and signals
     *
     * @private
     */
    _listen() {
        let onExit = () => {
            this._log('exit signal');

            this._exit();
        };

        let onMessage = (data) => {
            if (data && data.event === SIGNAL_OUT_OF_MEMORY) {
                this.rotate();
            }

            this.emit('message', data);
        };

        let onDisconnect = () => {
            this._log('disconnect signal');

            if (!this.started || this._disconnecting) {
                return;
            }

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
        if (this.worker) {
            this._log('clean up');

            this.worker.removeAllListeners();
            this.worker.kill();
            this.worker = null;
            this.started = false;
            this._disconnecting = false;

            this.emit('exit');

            this.removeAllListeners();
        }
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

        this.waitSignal(SIGNAL_DISCONNECT, () => {
            this._log('disconnect signal from master');
            cluster.worker.disconnect();
        });

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
     * Disconnect worker from master process
     */
    disconnect() {
        if (!cluster.isMaster) {
            throw new Error('Try disconnect from worker process');
        }

        if (!this._disconnecting) {
            this._disconnecting = true;

            this._log('disconnecting');

            // Max wait time
            let timeout = setTimeout(() => this._exit(), this.config.killOnDisconnectTimeout);

            // When worker report disconnect - exit
            //this.worker.on('disconnect', () => {
            //    clearTimeout(timeout);
            //
            //    this._exit();
            //});

            // When worker exit, cleanup
            this.worker.on('exit', () => {
                this._log('worker exit');
                clearTimeout(timeout);

                this._exit();
            });

            this.send({
                event: SIGNAL_DISCONNECT
            });

            // Send signal to worker to disconnect
            this.worker.disconnect();
        }
    }

    /**
     * Request worker rotation
     */
    rotate() {
        if (!this._rotating) {
            this._rotating = true;

            this._log('rotate request');

            this.emit('rotate');
        }
    }

    /**
     * Graceful worker shutdown
     */
    shutdown() {
        if (!cluster.isMaster) {
            throw new Error('This is master function');
        }

        // Try disconnect as white human
        this.disconnect();

        // Kill process
        setTimeout(() => this.kill(), this.config.killOnDisconnectTimeout);
    }

    /**
     * Check memory usage with interval
     *
     * @private
     */
    _startMemoryMonitoring() {
        setTimeout(() => this._checkMemory(), this.config.memoryCheckInterval);
    }

    /**
     * Check memory usage
     *
     * @private
     */
    _checkMemory() {
        let heapUsed = process.memoryUsage().heapUsed;

        if (heapUsed > this.config.maxAllowedMemory) {
            this._log('send out of memory: %d / %d', heapUsed, this.config.maxAllowedMemory);

            this.send({
                event: SIGNAL_OUT_OF_MEMORY
            });
        } else {
            this._startMemoryMonitoring();
        }
    }

    /**
     * Log with timestamp
     * @param {string} message
     * @param {*[]} args
     * @private
     */
    _log(message, ...args) {
        let date = new Date().toISOString();

        if (cluster.isMaster) {
            if (this.worker) {
                console.log('[%s] [master worker(%d)] ' + message, date, this.worker.process.pid, ...args);
            } else {
                console.log('[%s] [master] ' + message, date, ...args);
            }
        } else {
            console.log('[%s] [worker %d] ' + message, date, process.pid, ...args);
        }
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
     * @param {string} handleEvent
     * @param {function} callback
     */
    waitSignal(handleEvent, callback) {
        let target = cluster.isMaster ?
            this.worker :
            process;

        target.on('message', ({event, payload}) => {
            if (event === handleEvent) {
                callback(payload);
            }
        });
    }

    waitDisconnect(callback) {
        this.waitSignal(SIGNAL_DISCONNECT, callback);
    }

    /**
     * Kill worker
     */
    kill() {
        this._exit();
    }
}

module.exports.Worker = Worker;

let {resolve, dirname} = require('path');

class Config {

    constructor(argv) {
        this.env = {};
        this.plugins = [];

        this.workers = 2;

        this.memoryCheckInterval = 5000;
        this.maxAllowedMemory = 500 * 1024 * 1024;
        this.killOnDisconnectTimeout = 20000;
        this.disconnectHold = 5000;

        if (process.env.PLUSTER) {
            let configPath = resolve(argv[argv.length - 1]),
                config = require(configPath);

            this.app = config.app;
            this.cwd = dirname(configPath);
            this.enabled = true;

            Object.assign(this, config);
        } else {
            this.enabled = false;
        }
    }

    /**
     * @returns {{master: function, worker: function}[]}
     */
    getPlugins() {
        return this.plugins.map(plugin => {
            return require(resolve(plugin));
        });
    }

}

exports.Config = Config;

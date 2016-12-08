let {resolve, dirname} = require('path');

class Config {

    constructor(argv) {
        let configPath = resolve(argv[argv.length - 1]),
            config = require(configPath);

        this.app = config.app;
        this.workers = 2;
        this.cwd = dirname(configPath);

        this.env = {};

        this.memoryCheckInterval = 5000;
        this.maxAllowedMemory = 500 * 1024 * 1024;
        this.killOnDisconnectTimeout = 20000;

        this.plugins = [];

        Object.assign(this, config);
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

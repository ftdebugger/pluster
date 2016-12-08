Pluster
=======

Node.js cluster manager for memory leaked apps


Install
=======

    npm install -g pluster

Usage
=====

    pluster pluster.conf.js

Config
======

```js
module.exports = {
    // Required. Path to app
    app: 'dist/server/web.bundle.js',
    
    // Number of allowed workers
    workers: 2,

    // Environment
    env: {
        // pass port for example
        port: 3333  
    },
    
    // How often check memory
    memoryCheckInterval: 5000,
    
    // Memory threshold
    maxAllowedMemory: 500 * 1024 * 1024,
    
    // Timeout to kill worker, after dicsonnect
    killOnDisconnectTimeout: 20000,

    // pathes to plugins
    plugins: []
};

```

const got = require('got').default
const safeJSONStringify = require('json-stringify-safe')
const CONFIG_ERROR_MSG = 'Persistent context plugin cannot be used outside of FlowForge EE environment'

function stringify (value) {
    let hasCircular
    const result = safeJSONStringify(value, null, null, function (k, v) { hasCircular = true })
    return { json: result, circular: hasCircular }
}

const reviver = (keys, data) => {
    const result = keys.map(key => {
        const el = data.find(e => e.key === key)
        return el?.value
    })
    return result
}

function eeRejectOrCallback (reject, callback) {
    if (callback) {
        callback(new Error(CONFIG_ERROR_MSG))
    } else if (reject) {
        return Promise.reject(new Error(CONFIG_ERROR_MSG))
    }
}

function normaliseError (err) {
    let niceError = new Error('Unexpected error.')
    let statusCode = null
    let childErr = {}
    niceError.code ||= 'unexpected_error'
    if (typeof err === 'string') {
        niceError = new Error(err)
    } else if (err?._normalised) {
        return err // already normalised
    }
    if (err?.response) {
        statusCode = err.response.statusCode
        if (err.response.body) {
            try {
                if (err.response.body && typeof err.response.body === 'object') {
                    childErr = err.response.body
                } else {
                    childErr = { ...JSON.parse(err.response.body.toString()) }
                }
            } catch (_error) { /* do nothing */ }
            if (!childErr || typeof childErr !== 'object') {
                childErr = {}
            }
            Object.assign(niceError, childErr)
            niceError.message = childErr.error || childErr.message || niceError.message
            niceError.code = childErr.code || niceError.code
            niceError.stack = childErr.stack || niceError.stack
        }
    }
    if (statusCode === 413) {
        niceError.message = 'Quota exceeded.'
        if (childErr && childErr.limit) {
            niceError.message += ` The current limit is ${childErr.limit} bytes.`
        }
        niceError.code = 'quota_exceeded'
    }
    niceError.stack = niceError.stack || err.stack
    niceError.code = niceError.code || err.code
    niceError._normalised = true // prevent double processing
    return niceError
}

class FFContextStorage {
    constructor (opts) {
        opts = opts || {}
        const projectID = opts?.projectID || (process.env.FF_FS_TEST_CONFIG ? process.env.FLOWFORGE_PROJECT_ID : null)
        const projectToken = opts?.token || (process.env.FF_FS_TEST_CONFIG ? process.env.FLOWFORGE_PROJECT_TOKEN : null)
        const fileStoreURL = opts?.url || 'http://127.0.0.1:3001'
        this.validSetup = projectID && projectToken && fileStoreURL && fileStoreURL.startsWith('http')
        if (!this.validSetup) {
            console.warn(CONFIG_ERROR_MSG)
        }
        this.knownCircularRefs = {}
        /** @type {import('got').Got} */
        this.client = got.extend({
            prefixUrl: `${fileStoreURL}/v1/context/${projectID}`,
            headers: {
                'user-agent': 'FlowForge Node-RED File Nodes for Storage Server',
                authorization: 'Bearer ' + projectToken
            },
            timeout: {
                request: opts.requestTimeout || 500
            },
            retry: {
                limit: 0
            }
        })
        this.initialised = !!this.client
    }

    open () {
        return Promise.resolve()
    }

    close () {
        return Promise.resolve()
    }

    /**
     * Get one or more values from the context store
     * @param {'context'|'flow'|'global'} scope - The scope of the context to get keys for
     * @param {string|Array<string>} key - The key to get the value for
     * @param {Function} callback - The callback to call when the value has been retrieved
     * @example
     *     // get a single value
     *     http://localhost:3001/v1/context/project-id/flow?key=hello
     * @example
     *     // get multiple values
     *     http://localhost:3001/v1/context/project-id/global?key=hello&key=nested.object.property
     */
    get (scope, key, callback) {
        const path = `${scope}`
        const keys = Array.isArray(key) ? key : [key]
        if (!this.validSetup) {
            return eeRejectOrCallback(!callback, callback)
        }
        if (typeof callback !== 'function') {
            // TODO: consider adding a cache to permit synchronous calls
            return Promise.reject(new Error('This context store must be called asynchronously'))
        }
        const opts = {
            search: new URLSearchParams(keys.map(k => ['key', k])),
            responseType: 'json'
        }
        this.client.get(path, opts).then(res => {
            callback(null, ...reviver(keys, res.body))
        }).catch(error => { // TODO: If resource not found, return null or error?
            callback(normaliseError(error))
        })
    }

    /**
     * Set one or more values in the context store
     * @param {'context'|'flow'|'global'} scope - The scope of the context to set
     * @param {string|Array<string>} key - The key(s) to set the value for
     * @param {string|Array<string>} value - The value(s) to set for the given scope + key(s)
     * @param {Function} callback - The callback to call when the value(s) have been set
     * @example
     *    // set a single value
     *    http://localhost:3001/v1/context/project-id/flow
     *    // body
     *    [{ "key": "hello", "value": "world" }]
     * @example
     *    // set multiple values
     *    http://localhost:3001/v1/context/project-id/flow
     *    // body
     *    [{ "key": "hello", "value": "world" }, { "key": "nested.object.property", "value": "value" }]
     */
    set (scope, key, value, callback) {
        if (!this.validSetup) {
            return eeRejectOrCallback(!callback, callback)
        }
        if (typeof callback !== 'function') {
            // TODO: consider adding a cache to permit synchronous calls
            throw new Error('This context store must be called asynchronously')
        }
        const path = `${scope}`
        const data = Array.isArray(key) ? key.map((k, i) => ({ key: k, value: value[i] })) : [{ key, value }]
        const stringifiedContext = stringify(data)
        const opts = {
            responseType: 'json',
            body: stringifiedContext.json,
            headers: { 'Content-Type': 'application/json;charset=utf-8' }
        }
        this.client.post(path, opts).then(res => {
            callback(null)
        }).catch(error => {
            callback(normaliseError(error))
        })
    }

    /**
     * Get a list of keys for a given scope
     * @param {'context'|'flow'|'global'} scope - The scope of the context to get keys for
     * @param {Function} callback - The callback to call when the keys have been retrieved
     * @example
     *     http://localhost:3001/v1/context/project-id/global/keys
     */
    keys (scope, callback) {
        if (!this.validSetup) {
            if (callback) {
                callback(null, []) // quietly return empty key list
            } else {
                return Promise.resolve([]) // quietly return empty key list
            }
        }
        if (typeof callback !== 'function') {
            // TODO: consider adding a cache to permit synchronous calls
            throw new Error('This context store must be called asynchronously')
        }
        const path = `${scope}/keys`
        const opts = {
            responseType: 'json',
            headers: {
                'Content-Type': 'application/json;charset=utf-8',
                Accept: 'application/json'
            }
        }
        this.client.get(path, opts).then(res => {
            callback(null, res.body || [])
        }).catch(error => {
            callback(normaliseError(error))
        })
    }

    /**
     * Delete the context of the given node/flow/global
     * @param {String} scope - the scope to delete
     */
    delete (scope) {
        if (!this.validSetup) {
            return Promise.resolve() // quietly ignore
        }
        return this.client.delete(scope).then(() => {
            // done
        }).catch(error => {
            error.code ||= 'unexpected_error'
            // TODO: log error?
        })
    }

    /**
     * Delete any contexts that are no longer in use
     * @param {Array<string>} _activeNodes - a list of nodes still active
     */
    clean (_activeNodes) {
        if (!this.validSetup) {
            return Promise.resolve() // quietly ignore
        }
        const activeNodes = _activeNodes || []
        const opts = { json: activeNodes }
        return this.client.post('clean', opts).then(() => {
            // done
        }).catch(error => {
            error.code ||= 'unexpected_error'
            // TODO: log error?
        })
    }

    _export () {
        // TODO: needed? I think not looking through @node-red/runtime/lib/nodes/context/index.js
        return []
    }
}

module.exports = function (config) {
    return new FFContextStorage(config)
}

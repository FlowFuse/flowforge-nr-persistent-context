const FORGE_PROJECT_ID = 'test-project-1'
const FORGE_TEAM_ID = 'test-team-1'
const FORGE_STORAGE_URL = 'http://127.0.0.1:3001'
const FORGE_STORAGE_TOKEN = 'test-token-1'

const should = require('should') // eslint-disable-line no-unused-vars
const http = require('http')
const util = require('util')

// setup authentication endpoint
function authServer (config = {}) {
    const host = config.host || 'localhost'
    const port = config.port || 3002
    const authConfig = config.authConfig || [
        { token: FORGE_STORAGE_TOKEN, projectId: FORGE_PROJECT_ID }
    ]
    const requestListener = function (req, res) {
        try {
            let authToken
            const urlParts = req.url.split('/')
            const projectId = urlParts.pop()
            const route = urlParts.join('/')
            switch (route) {
            case '/account/check/project':
                authToken = authConfig.find(auth => auth.projectId === projectId)
                if (req.headers.authorization === ('Bearer ' + authToken.token)) {
                    res.writeHead(200)
                    res.end('{}')
                    return
                }
                throw new Error('Unknown request')
            default:
                res.writeHead(404)
                res.end(JSON.stringify({ error: 'Resource not found' }))
            }
        } catch (error) {
            res.writeHead(401)
            res.end(JSON.stringify({ error: 'unauthorised' }))
        }
    }

    const authServer = http.createServer(requestListener)
    authServer.listen(port, host, () => {
        // listening for requests on port 3002
    })
    return authServer
}

async function setupFileServerApp (config = {}) {
    process.env.FF_FS_TEST_CONFIG = `
FLOWFORGE_HOME: ${config.home || process.cwd()}
FLOWFORGE_PROJECT_ID: ${config.projectId || 'test-project-1'}
FLOWFORGE_TEAM_ID: ${config.teamId || 'test-team-1'}
host: ${config.host || '0.0.0.0'}
port: ${config.port || 3001}
base_url: 'http://localhost:3002'
driver:
    type: memory
    options:
        root: /var/root
context:
    type: memory
`
    const app = await require('@flowforge/file-server')
    return app
}

describe('Context Plugin', async function () {
    this.timeout(65000)
    let flowforgeApp
    let fileServerApp
    const plugin = require('../../lib/index')({
        projectID: FORGE_PROJECT_ID,
        token: FORGE_STORAGE_TOKEN,
        url: FORGE_STORAGE_URL
    })
    const setContext = util.promisify(plugin.set).bind(plugin)
    const getContext = util.promisify(plugin.get).bind(plugin)
    const keysContext = util.promisify(plugin.keys).bind(plugin)
    before(async function () {
        flowforgeApp = authServer({
            authConfig: [
                { token: 'test-token-1', projectId: 'test-project-1' },
                { token: 'test-token-2', projectId: 'test-project-2' }
            ]
        })
        fileServerApp = await setupFileServerApp({
            teamId: FORGE_TEAM_ID,
            projectId: FORGE_PROJECT_ID,
            token: FORGE_STORAGE_TOKEN
        })
        // sleep 500ms to allow file server to start
        await new Promise(resolve => setTimeout(resolve, 500))
    })
    after(async function () {
        if (fileServerApp) {
            await fileServerApp.close()
            fileServerApp = null
        }

        const closeFlowforgeApp = util.promisify(flowforgeApp.close).bind(flowforgeApp)
        await closeFlowforgeApp()
        flowforgeApp = null
    })
    describe('Basic set and get values in context', async function () {
        it('should set and get simple values in flow context', async function () {
            const contextVariable = 'test1'
            const contextValue = 'test1value'
            const contextScope = 'flow'
            await setContext(contextScope, contextVariable, contextValue)
            const result = await getContext(contextScope, contextVariable)
            should(result).be.equal(contextValue)
        })
        it('should set and get simple values in global context', async function () {
            const contextVariable = 'test2'
            const contextValue = 'test2value'
            const contextScope = 'global'
            await setContext(contextScope, contextVariable, contextValue)
            const result = await getContext(contextScope, contextVariable)
            should(result).be.equal(contextValue)
        })
        it('should set and get simple values in node context', async function () {
            const contextVariable = 'test3'
            const contextValue = 'test3value'
            const contextScope = 'a-node-id'
            await setContext(contextScope, contextVariable, contextValue)
            const result = await getContext(contextScope, contextVariable)
            should(result).be.equal(contextValue)
        })
    })

    describe('Clean context', async function () {
        it('should remove all context except global scope', async function () {
            await setContext('node-1', 'node-1-var-1', 'node-1-value-1')
            await setContext('node-2', 'node-2-var-1', 'node-2-value-1')
            await setContext('flow', 'flow-var-1', 'flow-value-1')
            await setContext('global', 'global-var-1', 'global-value-1')
            await plugin.clean()

            // node and flow context should be removed
            const nc = await getContext('node-1', 'node-1-var-1')
            const nc2 = await getContext('node-2', 'node-2-var-1')
            const fc = await getContext('flow', 'flow-var-1')
            should(nc).be.undefined()
            should(nc2).be.undefined()
            should(fc).be.undefined()

            // global context should not be removed
            const gc = await getContext('global', 'global-var-1')
            should(gc).be.not.undefined()
        })
    })

    describe('Access nested properties', async function () {
        this.timeout(65000)
        const nested = {
            obj1: { prop1: 1 },
            arr1: [11, 22, 33],
            integer1: 111,
            string1: 'string1 value',
            buffer1: Buffer.from('buffer1 value'),
            nested2: { nested3: { nested4: 'nested4 value' } }
        }
        beforeEach(async function () {
            await plugin.clean()
            setContext('flow', 'nested', nested)
            setContext('global', 'nested', nested)
            setContext('node-1', 'nested', nested)
        })
        it('should get full object from top level of flow context', async function () {
            const result = await getContext('flow', 'nested')
            should(result).be.an.Object()
            const nestedStringified = JSON.stringify(nested)
            const resultStringified = JSON.stringify(result)
            should(resultStringified).be.equal(nestedStringified)
        })
        it('should get full object from top level of global context', async function () {
            const result = await getContext('global', 'nested')
            should(result).be.an.Object()
            const nestedStringified = JSON.stringify(nested)
            const resultStringified = JSON.stringify(result)
            should(resultStringified).be.equal(nestedStringified)
        })
        it('should get full object from top level of node context', async function () {
            const result = await getContext('node-1', 'nested')
            should(result).be.an.Object()
            const nestedStringified = JSON.stringify(nested)
            const resultStringified = JSON.stringify(result)
            should(resultStringified).be.equal(nestedStringified)
        })
        it('should get a nested integer value from an object', async function () {
            const result = await getContext('node-1', 'nested.integer1')
            should(result).be.equal(nested.integer1)
        })
        it('should get a nested string value from an object', async function () {
            const result = await getContext('flow', 'nested.string1')
            should(result).be.equal(nested.string1)
        })
        it('should get a nested buffer value from an object', async function () {
            const result = await getContext('global', 'nested.buffer1')
            result.should.be.an.Object()
            result.should.have.property('type')
            result.should.have.property('data')
            const buf = Buffer.from(result.data)
            should(buf.toString()).be.equal(nested.buffer1.toString())
        })
        it('should get nested value from an object', async function () {
            const result = await getContext('node-1', 'nested.obj1.prop1')
            should(result).be.equal(nested.obj1.prop1)
        })
        it('should get nested value from an array', async function () {
            const result = await getContext('flow', 'nested.arr1[2]')
            should(result).be.equal(nested.arr1[2])
        })
        it('should get nested value from an nested object', async function () {
            const result = await getContext('global', 'nested.nested2.nested3.nested4')
            should(result).be.equal(nested.nested2.nested3.nested4)
        })
    })

    describe('Set nested properties in context', async function () {
        this.timeout(65000)
        const nested = {
            obj1: { prop1: 1 },
            arr1: [11, 22, 33],
            integer1: 111,
            string1: 'string1 value',
            buffer1: Buffer.from('buffer1 value'),
            nested2: { nested3: { nested4: 'nested4 value' } }
        }
        beforeEach(async function () {
            await plugin.clean()
            setContext('flow', 'nested', nested)
            setContext('global', 'nested', nested)
            setContext('node-1', 'nested', nested)
        })
        it('should set nested property on non existing object in flow scope', async function () {
            await setContext('flow', 'newFlowVar.newFlowVar2', 'newFlowVar2 value')
            const result = await getContext('flow', 'newFlowVar')
            result.should.deepEqual({ newFlowVar2: 'newFlowVar2 value' })
        })
        it('should set nested property on non existing object in global scope', async function () {
            await setContext('global', 'newGlobalVar.newGlobalVar2', 'newGlobalVar2 value')
            const result = await getContext('global', 'newGlobalVar')
            result.should.deepEqual({ newGlobalVar2: 'newGlobalVar2 value' })
        })
        it('should set nested property on non existing object in node scope', async function () {
            await setContext('node-1', 'new-node-1-var.new-node-1-var2', 'new-node-1-var2 value')
            const result = await getContext('node-1', 'new-node-1-var')
            result.should.deepEqual({ 'new-node-1-var2': 'new-node-1-var2 value' })
        })
        it('should set a nested value on an existing nested object in flow scope', async function () {
            await setContext('flow', 'nested.nested2.nested3.nested4b', 'nested4b value')
            const result = await getContext('flow', 'nested.nested2.nested3')
            result.should.deepEqual({ nested4: 'nested4 value', nested4b: 'nested4b value' })
        })
        it('should set a nested value on an existing nested object in global scope', async function () {
            await setContext('global', 'nested.nested2.nested3.nested4b', 'nested4b value')
            const result = await getContext('global', 'nested.nested2.nested3')
            result.should.deepEqual({ nested4: 'nested4 value', nested4b: 'nested4b value' })
        })
        it('should set a nested value on an existing nested object in node scope', async function () {
            await setContext('node-1', 'nested.nested2.nested3.nested4b', 'nested4b value')
            const result = await getContext('node-1', 'nested.nested2.nested3')
            result.should.deepEqual({ nested4: 'nested4 value', nested4b: 'nested4b value' })
        })
    })

    describe('Delete context entries', async function () {
        this.timeout(65000)
        const nested = {
            obj1: { prop1: 1 },
            arr1: [11, 22, 33],
            integer1: 111,
            string1: 'string1 value',
            buffer1: Buffer.from('buffer1 value'),
            nested2: { nested3: { nested4: 'nested4 value' } }
        }
        beforeEach(async function () {
            await plugin.clean()
            setContext('flow', 'nested', nested)
            setContext('global', 'nested', nested)
            setContext('node-1', 'nested', nested)
        })
        it('should delete top level context item in flow scope', async function () {
            await setContext('flow', 'nested', undefined)
            should(await getContext('flow', 'nested')).be.undefined()
            should(await getContext('global', 'nested')).be.an.Object()
            should(await getContext('node-1', 'nested')).be.an.Object()
        })
        it('should delete top level context item in global scope', async function () {
            await setContext('global', 'nested', undefined)
            should(await getContext('flow', 'nested')).be.an.Object()
            should(await getContext('global', 'nested')).be.undefined()
            should(await getContext('node-1', 'nested')).be.an.Object()
        })
        it('should delete top level context item in node scope', async function () {
            await setContext('node-1', 'nested', undefined)
            should(await getContext('flow', 'nested')).be.an.Object()
            should(await getContext('global', 'nested')).be.an.Object()
            should(await getContext('node-1', 'nested')).be.undefined()
        })
        it('should delete nested context item in flow scope', async function () {
            await setContext('flow', 'nested.nested2.nested3', undefined)
            const result = await getContext('flow', 'nested')
            result.should.have.a.property('nested2', {})
        })
        it('should delete nested context item in global scope', async function () {
            await setContext('global', 'nested.nested2.nested3', undefined)
            const result = await getContext('global', 'nested')
            result.should.have.a.property('nested2', {})
        })
        it('should delete nested context item in node scope', async function () {
            await setContext('node-1', 'nested.nested2.nested3', undefined)
            const result = await getContext('node-1', 'nested')
            result.should.have.a.property('nested2', {})
        })
    })
    describe('Get Keys', async function () {
        this.timeout(65000)
        before(async function () {
            await plugin.clean()
            await setContext('node-1', 'node-1-var-1', 'node-1-value-1')
            await setContext('node-1', 'node-1-var-2', 'node-1-value-2')
            await setContext('node-1', 'node-1-var-3', 'node-1-value-3')
            await setContext('node-2', 'node-2-var-1', 'node-2-value-1')
            await setContext('node-2', 'node-2-var-2', 'node-2-value-2')
            await setContext('node-2', 'node-2-var-3', 'node-2-value-3')
            await setContext('flow', 'flow-var-1', 'flow-value-1')
            await setContext('flow', 'flow-var-2', 'flow-value-2')
            await setContext('flow', 'flow-var-3', 'flow-value-3')
            await setContext('global', 'global-var-1', 'global-value-1')
            await setContext('global', 'global-var-2', 'global-value-2')
            await setContext('global', 'global-var-3', 'global-value-3')
        })
        it('should get keys for flow scope', async function () {
            const result = await keysContext('flow')
            should(result).deepEqual(['flow-var-1', 'flow-var-2', 'flow-var-3'])
        })
        it('should get keys for global scope', async function () {
            const result = await keysContext('global')
            // note, others tests may have populated global context
            // and the clean() in the `before` hook does not remove them
            // so we need to check that the keys we expect are there
            should(result).be.an.Array()
            result.should.containEql('global-var-1')
            result.should.containEql('global-var-2')
            result.should.containEql('global-var-3')
        })
        it('should get keys for node scope: node-1', async function () {
            const result = await keysContext('node-1')
            should(result).deepEqual(['node-1-var-1', 'node-1-var-2', 'node-1-var-3'])
        })
        it('should get keys for node scope: node-2', async function () {
            const result = await keysContext('node-2')
            should(result).deepEqual(['node-2-var-1', 'node-2-var-2', 'node-2-var-3'])
        })
    })

    describe('Delete Scope', async function () {
        this.timeout(65000)
        beforeEach(async function () {
            await plugin.clean()
            await setContext('node-1', 'node-1-var-1', 'node-1-value-1')
            await setContext('node-1', 'node-1-var-2', 'node-1-value-2')
            await setContext('node-1', 'node-1-var-3', 'node-1-value-3')
            await setContext('node-2', 'node-2-var-1', 'node-2-value-1')
            await setContext('node-2', 'node-2-var-2', 'node-2-value-2')
            await setContext('node-2', 'node-2-var-3', 'node-2-value-3')
            await setContext('flow', 'flow-var-1', 'flow-value-1')
            await setContext('flow', 'flow-var-2', 'flow-value-2')
            await setContext('flow', 'flow-var-3', 'flow-value-3')
            await setContext('global', 'global-var-1', 'global-value-1')
            await setContext('global', 'global-var-2', 'global-value-2')
            await setContext('global', 'global-var-3', 'global-value-3')
        })
        it('should delete global scope', async function () {
            await plugin.delete('global')
            const globalKeys = await keysContext('global')
            globalKeys.should.deepEqual([])
            // ensure other scopes are not affected
            const node1Keys = await keysContext('node-1')
            node1Keys.should.deepEqual(['node-1-var-1', 'node-1-var-2', 'node-1-var-3'])
            const node2Keys = await keysContext('node-2')
            node2Keys.should.deepEqual(['node-2-var-1', 'node-2-var-2', 'node-2-var-3'])
            const flowKeys = await keysContext('flow')
            flowKeys.should.deepEqual(['flow-var-1', 'flow-var-2', 'flow-var-3'])
        })
        it('should delete flow scope only', async function () {
            await plugin.delete('flow')
            const flowKeys = await keysContext('flow')
            flowKeys.should.deepEqual([])
            // ensure other scopes are not affected
            const node1Keys = await keysContext('node-1')
            node1Keys.should.deepEqual(['node-1-var-1', 'node-1-var-2', 'node-1-var-3'])
            const node2Keys = await keysContext('node-2')
            node2Keys.should.deepEqual(['node-2-var-1', 'node-2-var-2', 'node-2-var-3'])
            const globalKeys = await keysContext('global')
            globalKeys.should.deepEqual(['global-var-1', 'global-var-2', 'global-var-3'])
        })
        it('should delete node-1 scope only', async function () {
            await plugin.delete('node-1')
            // ensure node-1 scope is empty
            const node1Keys = await keysContext('node-1')
            node1Keys.should.deepEqual([])

            // ensure other scopes are not affected
            const node2Keys = await keysContext('node-2')
            node2Keys.should.deepEqual(['node-2-var-1', 'node-2-var-2', 'node-2-var-3'])
            const flowKeys = await keysContext('flow')
            flowKeys.should.deepEqual(['flow-var-1', 'flow-var-2', 'flow-var-3'])
            const globalKeys = await keysContext('global')
            globalKeys.should.deepEqual(['global-var-1', 'global-var-2', 'global-var-3'])
        })
    })
})

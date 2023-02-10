# @flowforge/nr-persistent-context

A Node-RED Context Plugin for the FlowForge platform.

This plugin provides persistent context for a Node-RED instance
on the FlowForge platform.

### Configuration

```js
contextStorage: {
    file: {
        module: require("@flowforge/nr-persistent-context"),
        config: {
            projectID: process.env['FORGE_PROJECT_ID'],
            baseURL: process.env['FORGE_STORAGE_URL'],
            token: process.env['FORGE_STORAGE_TOKEN'],
            requestTimeout: 3000,
            pageSize: 20,
            flushInterval: 30,
            cache: true
        }
    }
}
```

 - `projectID` - is the UUID of the project (provided by FlowForge)
 - `baseURL` - the root URL for the FlowForge Storage API (provided by FlowForge)
 - `token` - authentication token (provided by FlowForge)
 - `requestTimeout` - (optional) The number of milliseconds to wait before timing out a request (Type:`number`, Default:`3000`)
 - `pageSize` - (optional) The number of context items/rows to fetch per page (Type:`number`, Default:`20`)
 - `flushInterval` - (optional) The number of seconds to wait before flushing pending writes (Type:`number`, Default:`30`)
 - `cache` - (optional) Whether to cache context items in memory (required for synchronous get/set) (Type:`boolean`, Default:`true`)

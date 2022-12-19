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
            token: process.env['FORGE_STORAGE_TOKEN']
        }
    }
}
```

 - `projectID` - is the UUID of the project
 - `baseURL` - the root URL for the FlowForge Storage API
 - `token` - authentication token

### Known Limitations
- Currently, only async versions of context get and context set are supported
  e.g. 
  ```js
  // SUPPORTED...
  global.set("var1", "persistent", "i am the value", (err) => {
     //do something
  })
  global.get("var1", "persistent", (err, val) => {
    //do something with val
  })
  
  // UNSUPPORTED...
  // global.set("var1", "persistent", "i am the value")
  // const value = global.get("var1", "persistent")

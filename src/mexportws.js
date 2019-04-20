import fs from 'fs-extra'
import mkdirp from 'mkdirp'
import path from 'path'
import chalk from 'chalk'
//
import { ensureDir, ellipse, getEndpoint, readFile, readJson } from './util'

// Plugin boilerplate
export const command = 'mexportws [id] [--output] [--project] [--endpoint]'
export const desc = 'Export a workspace'
export const builder = {
  id: {
    description: 'Identity of the workspace'
  },
  output: {
    alias: 'o',
    description: 'Optional dir'
  },
  endpoint: {
    alias: 'e',
    description: 'Optional endpoint to use'
  }
}

const query = `
  fragment kindFields on Kind {
    id
    name
    serviceId
    description
    thumbnailUrl
    isPublic
    isManaged
    isSystem
    schema {
      id
      name
      type
      description
      modifiers
      typeKindId
      displayAs
      hide
      autoFocus
      readonly
    }
    nameField
  }

  fragment serviceFields on Service {
    id
    name
    description
    isManaged
    isSystem
    isReadOnly
    endpointUrl
    subscriptionEndpointUrl
    assistantUrl
    thumbnailUrl
    tags
    created
    modified
    schema
    serviceType
    provider
    logicType
    logicTemplate
    # aggregatedServices
    refreshPeriod
    lastChecked
  }

  fragment operationFields on Operation {
    id
    type
  }

  fragment portalGraphNodeFields on PortalGraphNode {
    id
    x
    y
    width
    height
    collapsed
    knowledgeGraphNode {
      id
      kind {
        ...kindFields
      }
      instance {
        id
        name
      }
    }
    queryGraphNode {
      id
    }
    functionGraphNode {
      id
      operationId
    }
  }

  query exportWorkspace($id: ID!) {
    workspace(id: $id) {
      id
      name
      thumbnailUrl
      owner {
        id
        name
        email
        picture
      }
      isPublic
      isTemplate
      createdOn
      lastOpenedOn
      layout {
        id
        explorerOpen
        explorerSize
        inventoryOpen
        inventorySize
        contextOpen
        contextMode
        contextSize
        dataVizOpen
        dataVizSize
      }
      services {
        ...serviceFields
      }
      portalGraphs {
        id
        name
        type
        expanded
        zoom
        offsetX
        offsetY
        nodes {
          ...portalGraphNodeFields
        }
      }
      inventory {
        workspaceKinds {
          ...kindFields
        }
        functions {
          id
          name
          description
          arguments {
            id
            name
            type
            typeKindId
          }
          outputType
          outputKindId
          outputModifiers
          graphqlOperationType
          functionType
          implementation {
            id
            entrypoint {
              ...operationFields
            }
            operations {
              ...operationFields
            }
          }
          service {
            id
          }
        }
      }
    }
  }
  `

export const handler = async (context, argv) => {
  // console.log("context", context);
  // console.log("argv", argv);

  const config = await context.getProjectConfig()
  // console.log("config", config);

  const configPath = config.configPath

  const extensions = config.extensions || {}
  // console.log("extensions", extensions);

  const options = extensions.maana || {}
  // console.log("options", options);

  const endpoint = getEndpoint(config, argv)
  if (!endpoint) return
  const client = endpoint.getClient()

  if (!argv.id) {
    console.log(chalk.red(`✘ Must specify a workspace ID`))
    return
  }

  const variables = { id: argv.id }

  context.spinner.start(chalk.yellow(`Exporting workspace`))
  const result = await client.request(query, variables)
  if (result['errors']) {
    context.spinner.fail(
      chalk.red(`Call failed! ${JSON.stringify(result['errors'])}`)
    )
    return
  }

  const ws = result.workspace

  // Output object that we build
  const output = { ...ws }

  // Final output
  const outputJson = JSON.stringify(output, null, 2)
  const filename = argv.output || `${ws.name}.json`
  fs.writeFile(filename, outputJson, 'utf8')

  // Success
  context.spinner.succeed(chalk.green(`Call succeeded`))
}

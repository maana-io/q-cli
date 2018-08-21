import {
  buildASTSchema,
  parse,
  GraphQLSchema,
  GraphQLObjectType,
  graphql,
  getNamedType,
  GraphQLNonNull,
  GraphQLID
} from 'graphql'
import papa from 'papaparse'
import fs from 'fs-extra'
import path from 'path'
import chalk from 'chalk'
import yaml from 'js-yaml'
//
import { ellipse, getEndpoint, readFile, readJson } from './util'

// Plugin boilerplate
export const command =
  'maddsvc [name] [--id] [--desc] [--source] [--manifest] [--project] [--endpoint]'
export const desc = 'Add or update a Maana Q service from source or manifest'
export const builder = {
  name: {
    description:
      'Name of the service (required for source, ignored for manifest)'
  },
  id: {
    alias: 'i',
    description: 'Optional unique identity of the service'
  },
  desc: {
    alias: 'd',
    description: 'Optional brief description of the service'
  },
  source: {
    alias: 's',
    description:
      "Model definition (GraphQL SDL) describing a fully 'managed' graph"
  },
  manifest: {
    alias: 'm',
    description: 'Manifest (JSON) describing a managed or unmanaged service'
  },
  endpoint: {
    alias: 'e',
    description: 'Optional endpoint to use'
  }
}

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

  let query
  let variables
  let manifest

  if (argv.manifest) {
    const filePath = path.parse(argv.manifest)
    const content = fs.readFileSync(argv.manifest, 'utf-8')
    if (filePath.ext === '.yml' || filePath.ext === '.yaml') {
      manifest = yaml.safeLoad(content)
    } else if (filePath.ext === '.json') {
      manifest = JSON.parse(content)
    } else {
      console.log(
        chalk.red(`✘ Unsupported manifest file type: ${filePath.ext}`)
      )
      return
    }
  } else if (argv.source) {
    manifest = {
      id: argv.id,
      name: argv.name,
      description: argv.desc,
      source: argv.source
    }
  } else {
    console.log(chalk.red(`✘ Must specify either a service source or manifest`))
    return
  }
  console.log('manifest', manifest)

  const schema = readFile(manifest.source)
  variables = {
    input: {
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      schema
    }
  }
  query = `
    mutation addServiceSource($input: AddServiceSourceInput!) {
      addServiceSource(input: $input)
    }
  `

  context.spinner.start(chalk.yellow(`Adding service`))
  const result = await client.request(query, variables)
  if (result['errors']) {
    context.spinner.fail(
      chalk.red(`Call failed! ${JSON.stringify(result['errors'])}`)
    )
  } else {
    context.spinner.succeed(
      chalk.green(
        `Call succeeded: ${chalk.yellow(ellipse(JSON.stringify(result)))}`
      )
    )
  }
}

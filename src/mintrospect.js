import {
  buildASTSchema,
  parse,
  getIntrospectionQuery,
  GraphQLSchema,
  GraphQLObjectType,
  graphql,
  getNamedType,
  GraphQLNonNull,
  GraphQLID
} from 'graphql'
import fs from 'fs-extra'
import path from 'path'
import chalk from 'chalk'
//
import { ellipse, getEndpoint, readFile, readJson } from './util'

// Plugin boilerplate
export const command = 'mintrospect [--output] [--project] [--endpoint]'
export const desc =
  'Introspect a service and generate a JSON version of the GraphQL schema'
export const builder = {
  output: {
    alias: 'o',
    description: 'Output file path (JSON); default = schema.json'
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

  const endpoint = getEndpoint(config, argv)
  if (!endpoint) return

  const client = endpoint.getClient()

  const output = argv.output || 'schema.json'

  context.spinner.start(chalk.yellow(`Introspecting service`))

  const result = await client.request(getIntrospectionQuery())
  if (result['errors']) {
    context.spinner.fail(
      chalk.red(`Call failed! ${JSON.stringify(result['errors'])}`)
    )
    return
  }

  const jsonString = JSON.stringify(result, null, 2)
  await fs.writeFile(output, jsonString)

  context.spinner.succeed(
    chalk.green(`Call succeeded: ${chalk.yellow(ellipse(jsonString))}`)
  )
}

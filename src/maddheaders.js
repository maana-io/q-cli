import chalk from 'chalk'
import { getGraphQLConfig } from 'graphql-config'

import { addHeadersToConfig } from './util'

// Plugin boilerplate
export const command = 'maddheaders [--project]'
export const desc = 'Add required Maana headers to your project(s)'

export const handler = async (context, argv) => {
  // get the full config file information
  let fullConfig = getGraphQLConfig()
  let config = fullConfig.config

  // if the user specified a specific project, we only want to edit the config
  // for that project
  if (argv.project) {
    if (config.projects && config.projects[argv.project]) {
      config = config.projects[argv.project]
    } else {
      console.log(chalk.red(`✘ Failed to find the project ${argv.project}`))
      if (config.projects && Object.keys(config.projects).length > 0) {
        console.log(
          chalk.yellow('Did you mean one of:'),
          chalk.green(Object.keys(config.projects).join(', '))
        )
      } else {
        console.log(
          chalk.yellow('Run'),
          chalk.green('graphql add-project'),
          chalk.yellow('to add a project to the .graphqlconfig')
        )
      }
      return
    }
  }

  addHeadersToConfig(config)
  fullConfig.saveConfig(fullConfig.config)

  console.log(chalk.green('✔ Successfully added the headers'))
}

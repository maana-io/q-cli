import chalk from 'chalk'
import { getGraphQLConfig, getGraphQLProjectConfig } from 'graphql-config'

// Plugin boilerplate
export const command = 'menv [--project] [--shell]'
export const desc = 'Export the required environment variable(s)'
export const builder = {
  shell: {
    alias: 's',
    description:
      'The name of your current shell, defaults to the SHELL environment variable'
  }
}

export const handler = async (context, argv) => {
  // get the graphqlConfig
  let config = null
  if (argv.project) {
    config = getGraphQLProjectConfig(undefined, argv.project)
  } else {
    config = getGraphQLConfig().config
  }

  const extensions = config.extensions || {}
  const options = extensions.maana || {}
  if (!options.auth) {
    console.log(chalk.red('✘ No authentication information available'))
    console.log(
      chalk.yellow('Run'),
      chalk.green('graphql msignin'),
      chalk.yellow('to sign into the Maana CLI')
    )
    return
  }

  const auth = JSON.parse(Buffer.from(options.auth, 'base64').toString())
  const shell = getShell(argv.shell)
  const outputConfig = getOutputConfig(shell, auth.access_token, argv.project)
  console.log(produceEvalOutput(outputConfig))
}

function produceEvalOutput(config) {
  return `${config.prefix}MAANA_AUTH_TOKEN${config.delimiter}${config.token}${
    config.suffix
  }${config.comment} Run this command to configure your shell\n${
    config.comment
  } ${config.cmd}`
}

function getShell(shell) {
  if (!shell) {
    // TODO: Add additional checks for windows systems
    if (process.env.SHELL) {
      return process.env.SHELL.substr(process.env.SHELL.lastIndexOf('/') + 1)
    }
  }

  return shell
}

function getOutputConfig(shell, token, project) {
  let shellConfig = {}
  let command = 'gql menv'
  if (project) command = `${command} --project ${project}`
  if (shell) command = `${command} --shell ${shell}`
  switch (shell) {
    case 'fish':
      shellConfig.prefix = 'set -gx '
      shellConfig.suffix = '";\n'
      shellConfig.delimiter = ' "'
      shellConfig.comment = '#'
      shellConfig.cmd = `eval (${command})`
      break
    case 'powershell':
      shellConfig.prefix = '$Env:'
      shellConfig.suffix = '"\n'
      shellConfig.delimiter = ' = "'
      shellConfig.comment = '#'
      shellConfig.cmd = `& ${command} | Invoke-expression`
      break
    case 'cmd':
      shellConfig.prefix = 'SET '
      shellConfig.suffix = '\n'
      shellConfig.delimiter = '='
      shellConfig.comment = 'REM'
      shellConfig.cmd = `\t@FOR /f "tokens=*" %%i IN ('${command}') DO @%%i`
      break
    case 'tcsh':
      shellConfig.prefix = 'setenv '
      shellConfig.suffix = '";\n'
      shellConfig.delimiter = ' "'
      shellConfig.comment = ':'
      shellConfig.cmd = `eval ${command}`
      break
    case 'emacs':
      shellConfig.prefix = '(setenv "'
      shellConfig.suffix = '")\n'
      shellConfig.delimiter = '" "'
      shellConfig.comment = ';;'
      shellConfig.cmd = `(with-temp-buffer (shell-command "${command}" (current-buffer)) (eval-buffer))`
      break
    default:
      shellConfig.prefix = 'export '
      shellConfig.suffix = '"\n'
      shellConfig.delimiter = '="'
      shellConfig.comment = '#'
      shellConfig.cmd = `eval $(${command})`
  }

  return { ...shellConfig, token }
}

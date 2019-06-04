import chalk from 'chalk'
import { getGraphQLConfig, getGraphQLProjectConfig } from 'graphql-config'
import inquirer from 'inquirer'
import shell from 'shelljs'
import fs from 'fs'
import stripBom from 'strip-bom'
var path = require('path')

const prompt = inquirer.createPromptModule()

const scripts = {
  publish: __dirname + `/scripts/publish.sh`,
  deploy: __dirname + `/scripts/deploy.sh`,
  update: __dirname + `/scripts/update.sh`
}

export const command = 'mdeploy'
// [serviceName] [servicePath] [registryPath] [versionTag] [numReplicas]
export const describe = 'Deploy your service to Kubernetes'
export const builder = {
  programatic: {
    alias: 'pr',
    describe:
      'Disable the interactive mode of the CLI to use it programatically',
    type: 'boolean',
    default: false
  },
  serviceName: {
    alias: 'name',
    describe: 'The name for the service',
    type: 'string',
    default: ''
  },
  servicePath: {
    alias: 'path',
    describe:
      'The path to the folder containing the Dockerfile for the service',
    type: 'string',
    default: ''
  },
  registryPath: {
    alias: 'registry',
    describe: 'The hostname to a container registry',
    type: 'string',
    default: ''
  },
  versionTag: {
    alias: 'tag',
    describe: 'The version tag for the service',
    type: 'string',
    default: ''
  },
  numReplicas: {
    alias: 'replicas',
    describe: 'The number of pods for the service',
    type: 'number',
    default: 0
  }
}

const azureLogin = async () => {
  console.log(chalk.blueBright('Please log in to your Azure account:'))

  const credentials = await prompt([
    {
      message: 'Username:',
      type: 'input',
      name: 'username'
    },
    {
      message: 'Password:',
      type: 'password',
      name: 'password'
    }
  ])

  const { username, password } = credentials

  shell.exec(`az login -u ${username} -p ${password}`)

  console.log(chalk.green('Success!'))
}

const azureDeploy = async () => {
  const resourceGroupsResponse = shell.exec('az group list -o json')
  const resourceGroups = JSON.parse(resourceGroupsResponse.stdout)

  const resourceGroupQuestion = [
    {
      message: 'Which resource group would you like to use?',
      name: 'resourceGroup',
      type: 'list',
      choices: resourceGroups
    }
  ]

  const resourceGroupAnswer = await prompt(resourceGroupQuestion)
  const { resourceGroup } = resourceGroupAnswer

  const aksServicesRespinse = shell.exec(
    `az aks list --resource-group ${resourceGroup}`
  )
  const aksServices = JSON.parse(aksServicesRespinse.stdout)

  const aksServiceQuestion = [
    {
      message: 'Which AKS cluster would you like to use?',
      name: 'aksService',
      type: 'list',
      choices: aksServices
    }
  ]

  const aksServiceAnswer = await prompt(aksServiceQuestion)
  const { aksService } = aksServiceAnswer

  console.log(chalk.blueBright('Getting AKS credentials'))
  shell.exec(
    `az aks get-credentials --resource-group ${resourceGroup} --name ${aksService} --override`
  )
  console.log(chalk.green('Authenticated successfully with AKS'))

  const spacesResponse = shell.exec('azds space list -o json')
  const devSpacesNames = JSON.parse(spacesResponse.stdout).map(x => x.path)

  const devSpaceAnswer = await prompt([
    {
      message: 'Which Dev Space would you like to use?',
      name: 'devSpace',
      type: 'list',
      choices: devSpacesNames
    }
  ])
  const { devSpace } = devSpaceAnswer

  console.log(
    chalk.blueBright(`Selecting Dev Space `),
    chalk.greenBright(devSpace)
  )
  shell.exec(`azds space select -n ${devSpace} -y`)
  console.log(chalk.green('Dev space selected'))

  console.log(chalk.blueBright(`Preparing`))
  shell.exec('azds prep')

  console.log(chalk.blueBright(`Deploying`))
  shell.exec('azds up')

  console.log(chalk.bgGreen(`Deployment complete`))
}

const isServiceAvailable = serviceName => {
  try {
    let describe = JSON.parse(
      shell.exec(`kubectl get deployment ${serviceName} -o json`, {
        silent: true
      })
    )

    return describe && describe.status && describe.status.conditions
      ? describe.status.conditions[0].type === 'Available'
      : false
  } catch (e) {
    return false
  }
}

const registryDeploy = async (
  serviceName,
  servicePath,
  registryPath,
  versionTag,
  numReplicas,
  port
) => {
  //If service exist
  if (isServiceAvailable(serviceName)) {
    console.log(
      chalk.blueBright(`Found an existing service called ${serviceName}.`)
    )

    const deleteAndDeployOrUpdateQuestions = [
      {
        name: 'deleteAndDeployOrUpdate',
        message:
          'Would you like to delete the existing service and redeploy? Or would you rather just update?',
        type: 'list',
        choices: [
          { name: 'Delete and redeploy', value: 'delete' },
          { name: 'Update', value: 'update' }
        ]
      }
    ]

    const answers = await prompt(deleteAndDeployOrUpdateQuestions)

    switch (answers.deleteAndDeployOrUpdate) {
      case 'delete':
        shell.exec(
          `${
            scripts.deploy
          } ${serviceName} ${servicePath} ${registryPath} ${versionTag} ${numReplicas} ${port}`
        )
        break
      case 'update':
        shell.exec(
          `${
            scripts.publish
          } ${serviceName} ${servicePath} ${registryPath} ${versionTag}`
        )
        shell.exec(
          `${
            scripts.update
          } ${serviceName} ${servicePath} ${registryPath} ${versionTag} ${numReplicas} ${port}`
        )
        break
    }
  } else {
    shell.exec(
      `${
        scripts.publish
      } ${serviceName} ${servicePath} ${registryPath} ${versionTag}`
    )
    shell.exec(
      `${
        scripts.deploy
      } ${serviceName} ${servicePath} ${registryPath} ${versionTag} ${numReplicas} ${port}`
    )
  }
}

export const handler = async (context, argv) => {
  const questions = [
    {
      name: 'targetPlatform',
      message: 'What is target platform you are deplying to',
      type: 'list',
      choices: [
        { name: 'Private Docker Registry', value: 'registry' },
        { name: 'Azure AKS (Must have Azure CLI installed)', value: 'aks' }
      ]
    }
  ]
  const answers = await prompt(questions)

  console.log(argv)

  if (argv.programatic) {
    const {
      serviceName,
      servicePath,
      registryPath,
      versionTag,
      numReplicas,
      port
    } = argv

    await registryDeploy(
      serviceName,
      servicePath,
      registryPath,
      versionTag,
      numReplicas,
      port
    )
  } else {
    switch (answers.targetPlatform) {
      case 'aks':
        const homedir = require('os').homedir()
        const credentials = await fs.readFileSync(
          homedir + '/.azure/azureProfile.json',
          'utf8'
        )
        const { subscriptions } = JSON.parse(stripBom(credentials))

        if (subscriptions.length === 0) {
          await azureLogin()
        }

        await azureDeploy()
        console.log(chalk.green('Deployment on Azure AKS is Complete'))
        break
      case 'registry':
        const serviceNameShell = path.basename(process.cwd())

        const registryQuestions = [
          {
            name: 'serviceName',
            message: 'What is the service name?',
            default: serviceNameShell,
            type: 'string'
          },
          {
            name: 'servicePath',
            message:
              'What is the path to the folder containing your Dockerfile?',
            default: process.cwd() + '/service',
            type: 'string'
          },
          {
            name: 'registryPath',
            message: 'What is hostname for your container registry?',
            default: 'services.azurecr.io',
            type: 'string'
          },
          {
            name: 'versionTag',
            message: 'What version tag you would like to use?',
            default: 'v1',
            type: 'string'
          },
          {
            name: 'numReplicas',
            message: 'How many pods would you like to spin up?',
            default: 1,
            type: 'input'
          },
          {
            name: 'port',
            message: 'What is the port your application is running on?',
            default: 8050,
            type: 'input'
          }
        ]

        const registryOptions = await prompt(registryQuestions)

        const {
          serviceName,
          servicePath,
          registryPath,
          versionTag,
          numReplicas,
          port
        } = registryOptions

        const finalConfirmation = await prompt({
          message:
            `Please confirm the following deployment plan:\n` +
            `Deploying the service ${chalk.green(
              serviceName + ':' + versionTag
            )}\n` +
            `Located in ${chalk.green(servicePath)}\n` +
            `Publishing to ${chalk.green(registryPath)}\n` +
            `Number Of Pods: ${chalk.green(numReplicas)}\n` +
            `Exposing port ${chalk.green(port)}\n` +
            `Confirm?`,
          name: 'confirm',
          type: 'confirm'
        })

        if (finalConfirmation.confirm) {
          await registryDeploy(
            serviceName,
            servicePath,
            registryPath,
            versionTag,
            numReplicas,
            port
          )
        } else {
          console.log('Exiting...')
        }

        break
    }
  }
}

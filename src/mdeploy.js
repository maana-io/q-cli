import chalk from 'chalk'
import { getGraphQLConfig, getGraphQLProjectConfig } from 'graphql-config'
import inquirer from 'inquirer'
import shell from 'shelljs'
import fs from 'fs'
import stripBom from 'strip-bom'

const prompt = inquirer.createPromptModule()

export const command = 'mdeploy [--switch]'
export const desc = 'Deploy your service to Kubernetes'

const questions = [
  {
    name: 'targetPlatform',
    message: 'What is target platform you are deplying to',
    type: 'list',
    choices: [
      { name: 'Azure AKS (Must have Azure CLI installed)', value: 'aks' },
      { name: 'Standalone Kuberenetes Cluster', value: 'standalone' },
      { name: 'OpenShift', value: 'openshift' }
    ]
  }
]

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

const standaloneDeploy = async () => {
  console.log(chalk.red('Standalone is not yet supported'))
}

const openshiftDeploy = async () => {
  console.log(chalk.red('Deployment on Openshift is not yet supported'))
}

export const handler = async (context, argv) => {
  const answers = await prompt(questions)

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
    case 'standalone':
      await standaloneDeploy()
      break
    case 'openshift':
      await openshiftDeploy()
      break
  }
}

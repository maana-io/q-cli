import Zip from 'adm-zip'
import chalk from 'chalk'
import commandExists from 'command-exists'
import gh from 'parse-github-url'
import { spawn } from 'cross-spawn'
import fs from 'fs'
import { padEnd } from 'lodash'
import Path from 'path'
import request from 'request'
import tmp from 'tmp'
import rimraf from 'rimraf'

// Project boilerplates
export const defaultBoilerplates = [
  {
    name: 'node-js-basic-service-bot',
    description: 'A Node-based Knowledge Microservice/Bot (JavaScript)',
    repo: 'https://github.com/maana-io/Q-ksvc-templates/tree/master/node/basic'
  },
  {
    name: 'node-js-advanced-service-bot',
    description:
      'A Node-based 3-tier service stack (model+logic+ui) (Prisma/JavaScript/React)',
    repo:
      'https://github.com/maana-io/Q-ksvc-templates/tree/master/node/advanced'
  },
  {
    name: 'python-service-bot',
    description: 'A Python-based Knowledge Microservice/Bot (Simple)',
    repo:
      'https://github.com/maana-io/Q-ksvc-templates/tree/master/python/basic'
  },
  {
    name: 'python-graphene-service-bot',
    description: 'A Python-based Knowledge Microservice/Bot (Graphene)',
    repo:
      'https://github.com/maana-io/Q-ksvc-templates/tree/master/python/graphene'
  },
  {
    name: 'scala-service-bot',
    description: 'A Scala-based Knowledge Microservice/Bot',
    repo: 'https://github.com/maana-io/Q-ksvc-templates/tree/master/scala'
  },
  {
    name: 'go-service-bot',
    description: 'A Go Knowledge Microservice/Bot',
    repo: 'https://github.com/maana-io/Q-ksvc-templates/tree/master/go'
  },
  {
    name: 'react-app',
    description: 'React-based Knowledge Application',
    repo:
      'https://github.com/graphql-boilerplates/react-fullstack-graphql/tree/master/advanced'
  },
  {
    name: 'vue-app',
    description: 'Vue-based Knowledge Application',
    repo:
      'https://github.com/graphql-boilerplates/vue-fullstack-graphql/tree/master/advanced'
  }
]

// Plugin boilerplate
export const command = 'mcreate [directory]'
export const describe =
  'Bootstrap a new Maana Knowledge Microservice/Bot or Knowledge Application'

export const builder = {
  boilerplate: {
    alias: 'b',
    describe:
      'Full URL or repo shorthand (e.g. `owner/repo`) to boilerplate GitHub repository',
    type: 'string'
  },
  'no-install': {
    describe: `Don't install project dependencies`,
    type: 'boolean',
    default: false
  }
}

//
// Internal helpers
//
const getZipInfo = boilerplate => {
  let baseUrl = boilerplate
  let branch = 'master'
  let subDir = ''

  const branchMatches = boilerplate.match(
    /^(.*)\/tree\/([a-zA-Z-_0-9]*)\/?(.*)$/
  )
  if (branchMatches) {
    baseUrl = branchMatches[1]
    branch = branchMatches[2]
    subDir = branchMatches[3]
  }

  if (subDir === undefined) {
    subDir = ''
  }

  if (!subDir.startsWith('/')) {
    subDir = '/' + subDir
  }
  if (!subDir.endsWith('/')) {
    subDir = subDir + '/'
  }

  const nameMatches = baseUrl.match(/github\.com\/(.*)\/(.*)$/)
  if (!nameMatches) return

  const repoName = nameMatches[2]

  const url = `${baseUrl}/archive/${branch}.zip`
  const path = `${repoName}-${branch}${subDir}`

  return { url, path }
}

const getGitHubUrl = boilerplate => {
  const details = gh(boilerplate)

  if (details.host && details.owner && details.repo) {
    const branch = details.branch ? `/tree/${details.branch}` : ''
    return `https://${details.host}/${details.repo}${branch}`
  }
}

const shell = command => {
  return new Promise((resolve, reject) => {
    const commandParts = command.split(' ')
    const cmd = spawn(commandParts[0], commandParts.slice(1), {
      cwd: process.cwd(),
      detached: false,
      stdio: 'inherit'
    })

    cmd.on('error', reject)
    cmd.on('close', resolve)
  })
}

//
// Exported functions
//

export const handler = async (context, argv) => {
  let { boilerplate, directory, noInstall } = argv

  if (directory && directory.match(/[A-Z]/)) {
    console.log(
      `Project/directory name cannot contain uppercase letters: ${directory}`
    )
    directory = undefined
  }

  if (!directory) {
    const { newDir } = await context.prompt({
      type: 'input',
      name: 'newDir',
      default: '.',
      message: 'Directory for new Maana project',
      validate: dir => {
        if (dir.match(/[A-Z]/)) {
          return `Project/directory name cannot contain uppercase letters: ${directory}`
        }
        return true
      }
    })

    directory = newDir
  }
  if (!directory) return

  // make sure that project directory is empty
  const projectPath = Path.resolve(directory)

  if (fs.existsSync(projectPath)) {
    const allowedFiles = ['.git', '.gitignore']
    const conflictingFiles = fs
      .readdirSync(projectPath)
      .filter(f => !allowedFiles.includes(f))

    if (conflictingFiles.length > 0) {
      console.log(`Directory ${chalk.cyan(projectPath)} must be empty.`)
      return
    }
  } else {
    fs.mkdirSync(projectPath)
  }

  // allow short handle boilerplate (e.g. `node-basic`)
  if (boilerplate && !boilerplate.startsWith('http')) {
    const matchedBoilerplate = defaultBoilerplates.find(
      b => b.name === boilerplate
    )
    if (matchedBoilerplate) {
      boilerplate = matchedBoilerplate.repo
    } else {
      // allow shorthand GitHub URLs (e.g. `graphcool/graphcool-server-example`)
      boilerplate = getGitHubUrl(boilerplate)
    }
  }

  // interactive selection
  if (!boilerplate) {
    const maxNameLength = defaultBoilerplates
      .map(bp => bp.name.length)
      .reduce((max, x) => Math.max(max, x), 0)
    const choices = defaultBoilerplates.map(
      bp => `${padEnd(bp.name, maxNameLength + 2)} ${bp.description}`
    )
    const { choice } = await context.prompt({
      type: 'list',
      name: 'choice',
      message: `Choose Maana boilerplate project:`,
      choices
    })

    boilerplate = defaultBoilerplates[choices.indexOf(choice)].repo
  }
  if (!boilerplate) return

  // download repo contents
  const zipInfo = getZipInfo(boilerplate)
  const downloadUrl = zipInfo.url
  const tmpFile = tmp.fileSync()

  console.log(
    `[mcreate] Downloading boilerplate from ${downloadUrl} to ${
      tmpFile.name
    }...`
  )

  await new Promise(resolve => {
    request(downloadUrl)
      .pipe(fs.createWriteStream(tmpFile.name))
      .on('close', resolve)
  })

  const zip = new Zip(tmpFile.name)
  zip.extractEntryTo(zipInfo.path, projectPath, false)
  tmpFile.removeCallback()

  // run npm/yarn install
  if (!noInstall) {
    const subDirs = fs
      .readdirSync(projectPath)
      .map(f => Path.join(projectPath, f))
      .filter(f => fs.statSync(f).isDirectory())

    const installPaths = [projectPath, ...subDirs]
      .map(dir => Path.join(dir, 'package.json'))
      .filter(p => fs.existsSync(p))

    for (const packageJsonPath of installPaths) {
      process.chdir(Path.dirname(packageJsonPath))
      console.log(
        `[mcreate] Installing node dependencies for ${packageJsonPath}...`
      )
      if (commandExists.sync('npm')) {
        await shell('npm install')
      } else if (commandExists.sync('yarn')) {
        await shell('yarn install')
      } else {
        console.log(
          `Skipping install (no ${chalk.cyan('NPM')} or ${chalk.cyan('yarn')})`
        )
      }
    }
  }

  // change dir to projectPath for install steps
  process.chdir(projectPath)

  // run & delete setup script
  let installPath = Path.join(projectPath, 'install.js')
  if (!fs.existsSync(installPath)) {
    installPath = Path.join(projectPath, '.install')
  }

  if (fs.existsSync(installPath)) {
    console.log(`[mcreate] Running boilerplate install script... `)
    const installFunction = require(installPath)

    await installFunction({
      context,
      project: Path.basename(projectPath),
      projectDir: directory
    })

    rimraf.sync(installPath)
  }
}

#!/usr/bin/env node
const path = require('path');
const spawn = require('child-process-promise').spawn;
const yaml = require('js-yaml');
const fs   = require('fs');
const inquirer = require('inquirer');

const Moniker = require('moniker');
const names = Moniker.generator([Moniker.adjective, Moniker.noun]);

require('better-logging')(console);
require('dotenv').config({
  path: path.join(process.cwd(), '.env'),
  debug: process.env.DEBUG
})

// Scripts
const scriptsPath = __dirname + '/scripts/'
const buildAndPush = scriptsPath + 'build-and-push.sh'
const dockerComposeConfig = scriptsPath + 'docker-compose-config.sh'
const komposeConvert = scriptsPath + 'kompose-convert.sh'
const kubectlApply = scriptsPath + 'kubectl-apply.sh'
const exposeService = scriptsPath + 'expose-service.sh'
const version = scriptsPath + 'version.sh'

const spawnWithStreamOutput = async (script, env) => {  
  const promise = spawn(path.resolve(script), {
    env, 
    uid: process.uid,
    gid: process.gid
  })

  let childProcess = promise.childProcess;


  childProcess.stdout.on('data', function (data) {
    const result = data.toString()
    process.stdout.write(result);  
    
  });

  childProcess.stdout.on('close', function () {
    return    
  });
  
  childProcess.stderr.on('data', function (data) {
    const err = data.toString()
    process.stdout.write(err); 
  });

  try {
    await promise    
    return 
  }catch(e){
    console.error("Error", e)
  }
}

const ensureLoggedInToDockerRegistery = async () => {
  try {
    const answers = await inquirer.prompt([{
      name: 'loggedIn',
      message: 'In order to deploy you MUST be logged to a container registry. Continue?',
      type: 'confirm',      
    }]);    
    if (answers.loggedIn) return
    else {
      console.error("Please login to deploy")
      process.exit()    
    }
  } catch (e){ 
    console.error("Failed ensureing login")
    process.exit()
  }
}

const ensureDockerCompose = () => {
  return new Promise((resolve, reject) => {
    const dockerComposeYamlPath = path.join(process.cwd(), 'docker-compose.yaml')
    if (!fs.existsSync(dockerComposeYamlPath)){
      let services = {}          
      const { DOCKER_REGISTRY, SERVICE_ID, VERSION, PORT } = config      
      services[SERVICE_ID] = {     
        image: (DOCKER_REGISTRY ? `${DOCKER_REGISTRY}/` : '') + SERVICE_ID + ':' + VERSION,
        restart: 'always',
        ports: [`${PORT}:${PORT}`]
      }

      const dockerComposeJson = {      
        version: '3.1',
        services
      }

      const dockerComposeYaml = yaml.safeDump(dockerComposeJson, {
        'styles': {
          '!!null': 'canonical' // dump null as ~
        },
        'sortKeys': false
      })

      fs.writeFileSync(path.join(process.cwd(),'docker-compose.yaml'), dockerComposeYaml)

      console.log("Created docker-compose file.")
      resolve()
    } else {
      try {
        const dockerComposeJson = yaml.safeLoad(fs.readFileSync(dockerComposeYamlPath));
        const { services } = dockerComposeJson

        if (Object.keys(services).filter(service => service === process.env.SERVICE_ID).length === 0){
          console.error(`No service named ${process.env.SERVICE_ID} was found in the existing docker-compose.yaml file.`)
          console.error(`Please ensure a service named ${process.env.SERVICE_ID} is included`)
          reject()
        } else {
          resolve()
        }

      } catch (e) {
        console.log(e);
        reject()
      }
    }

    resolve()
  })
}

//Determine configuration
const packageJson = require(path.join(process.cwd(),'package.json'))
const config = {
    ...process.env,
    DOCKER_REGISTRY: process.env.DOCKER_REGISTRY || packageJson.dockerRegistry || false,
    SERVICE_ID: process.env.SERVICE_ID || packageJson.name || false,
    VERSION: process.env.VERSION || packageJson.version ||  'no-version',      
    PORT: process.env.PORT || 8050
}

export const command = 'mdeploy'
export const describe = 'Deploy your service to Kubernetes'
export const handler = async (context, argv) => {
  if (!config.SERVICE_ID){
    console.log("SERVICE_ID must be defined. Exiting...")
    process.exit(9)
  }

  if (!config.PORT){
    console.log("PORT must be defined. Exiting...")
    process.exit(9)
  }

  await ensureLoggedInToDockerRegistery();
  await ensureDockerCompose();
  [      
    buildAndPush,
    dockerComposeConfig,
    komposeConvert,
    kubectlApply,
    exposeService
  ].reduce( async (previousPromise, script) => {
    await previousPromise;
    return spawnWithStreamOutput(script, config);
  }, Promise.resolve());   
}

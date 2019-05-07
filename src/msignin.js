import chalk from 'chalk'
import request from 'request-promise-native'
import { getGraphQLConfig } from 'graphql-config'
import { addHeadersToConfig, IdentityProvider } from './util'
const querystring = require('querystring');

// Plugin boilerplate
export const command = 'msignin [Authentication Token] [--project]'
export const desc = 'Sign into the Maana CLI'

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

  let extensions = config.extensions || {}
  if (!config.extensions) config.extensions = extensions

  let maanaOptions = extensions.maana || {}
  if (!extensions.maana) extensions.maana = maanaOptions

  // make sure we have the authentication token
  let authConfig = null
  if (argv.AuthenticationToken) {
    authConfig = JSON.parse(Buffer.from(argv.AuthenticationToken, 'base64').toString())
  } else {
    const { authToken } = await context.prompt({
      type: 'password',
      name: 'authToken',
      message: 'Enter authentication token:'
    })

    if (!authToken) {
      console.log(
        chalk.red(
          '✘ Authentication token is required to sign into the Maana CLI'
        )
      )
      return
    }
    authConfig = JSON.parse(Buffer.from(authToken, 'base64').toString())
  }

  let requestConfig
  let authInfo

  // Fetch anything else and persist to config.
  try {
    // Set auth info to Auth0 repsonse, containing token.
    if(!authConfig.IDP || authConfig.IDP === IdentityProvider.Auth0){
      // Auth0 uses Authentication Code Flow and PKCE.
      requestConfig = {
        method: 'POST',
        url: authConfig.url,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: authConfig.id,
          code_verifier: Buffer.from(authConfig.state, 'base64').toString(),
          code: authConfig.code,
          redirect_uri: authConfig.ruri
        })
      }
      console.log(chalk.green('✔ Auth provider configured as Auth0')) 
    }
    // Keycloak uses Authentication Code Flow and PKCE.
    else if(authConfig.IDP === IdentityProvider.KeyCloak){
      var form = {
        grant_type: 'authorization_code',
        client_id: authConfig.id,
        code_verifier: Buffer.from(authConfig.state, 'base64').toString(),
        code: authConfig.code,
        redirect_uri: authConfig.ruri
      }
      
      var formData = querystring.stringify(form);
      var contentLength = formData.length;
      requestConfig = {
        headers: {
          'Content-Length': contentLength,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        uri: authConfig.url,
        body: formData,
        method: 'POST'
      }
      console.log(chalk.green('✔ Auth provider configured as keycloak'))   
    }

    let response = await request(requestConfig)
    authInfo = JSON.parse(response)
    authInfo.expires_at = Date.now() + authInfo.expires_in * 1000
    authInfo.url = authConfig.url
    authInfo.id = authConfig.id

    // If we have IDP persist this for refresh.
    if (authConfig.IDP){
      authInfo.IDP = authConfig.IDP
    }

    // add auth information to the cofig and save it
    maanaOptions.auth = Buffer.from(JSON.stringify(authInfo)).toString('base64')
    addHeadersToConfig(config)
    fullConfig.saveConfig(fullConfig.config)

    console.log(chalk.green('✔ Successfully signed into Maana CLI'))
    // TODO:  Add a command that can be used to export the env variable
  } catch (e) {
    if (e.response && e.response.statusCode) {
        console.log(
        chalk.red(`✘ Failed to sign in with status ${e.response.statusCode}`)
      )
      if (e.response.body) {
        const body = JSON.parse(e.response.body)
        console.log(chalk.yellow(`${body.error}: ${body.error_description}`))
      }
    } else {
      console.log(chalk.red(`✘ Failed to sign in: ${e.message}`))
    }
  }
}
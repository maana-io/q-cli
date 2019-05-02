import chalk from 'chalk'
import request from 'request-promise-native'
import { getGraphQLConfig } from 'graphql-config'
var querystring = require('querystring');

// Plugin boilerplate
export const command = 'mrefreshauth [--project]'
export const desc = 'Refresh authentication of the Maana CLI'

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

  // make sure we have the authentication config
  if (!maanaOptions.auth) {
    console.log(chalk.red('✘ No authentication information available'))
    console.log(
      chalk.yellow('Run'),
      chalk.green('graphql msignin'),
      chalk.yellow('to sign into the Maana CLI')
    )
    return
  }
  let authConfig = JSON.parse(
    Buffer.from(maanaOptions.auth, 'base64').toString()
  )

  // Define enum for supported IDPs.
  const IdentityProvider = Object.freeze({
    Auth0: 'auth0',
    KeyCloak: 'keycloak'
  })

  let requestConfig
  
  // Auth0 request
  if(!authConfig.IDP || authConfig.IDP === IdentityProvider.Auth0)
  {
    requestConfig = {
      method: 'POST',
      url: authConfig.url,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: authConfig.id,
        refresh_token: authConfig.refresh_token
      })
    }
  }
  // Keycloak request
  else if (authConfig.IDP === IdentityProvider.KeyCloak){
    var form = {
      grant_type: 'refresh_token',
      client_id: authConfig.id,
      refresh_token: authConfig.refresh_token
    };
    
    var formData = querystring.stringify(form);
    var contentLength = formData.length;
    requestConfig = {
      headers: {
        'Content-Length': contentLength,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      uri: `${authConfig.url}/auth/realms/${authConfig.realm}/protocol/openid-connect/userinfo`,
      body: formData,
      method: 'POST'
    }
  } else{
    console.log(
      chalk.red(
        `✘ Cannot refresh token from unsupported IDP: ${authConfig.IDP}`
      )
    )
  }

  try {
    let response = await request(requestConfig)
    // build the auth information
    let authInfo = JSON.parse(response)

    if (!authInfo.IDP || authInfo.IDP === IdentityProvider.Auth0){
      authConfig.expires_at = Date.now() + authInfo.expires_in * 1000
      authConfig.access_token = authInfo.access_token
    } else if(authInfo.IDP === IdentityProvider.KeyCloak) {
      // Account for different token format from keycloak.
      authConfig.expires_at = authInfo.tokenParsed.exp * 1000
      authConfig.access_token = authInfo.token
    }

    // add auth information to the cofig and save it
    maanaOptions.auth = Buffer.from(JSON.stringify(authConfig)).toString(
      'base64'
    )
    fullConfig.saveConfig(fullConfig.config)

    console.log(chalk.green("✔ Successfully refreshed Maana CLI's Auth"))
  } catch (e) {
    if (e.response && e.response.statusCode) {
      console.log(
        chalk.red(
          `✘ Failed to refresh auth with status ${e.response.statusCode}`
        )
      )
      if (e.response.body) {
        const body = JSON.parse(e.response.body)
        console.log(chalk.yellow(`${body.error}: ${body.error_description}`))
      }
    } else {
      console.log(chalk.red(`✘ Failed to refresh auth: ${e.message}`))
    }
  }
}

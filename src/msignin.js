import chalk from 'chalk'
import request from 'request-promise-native'
import { getGraphQLConfig } from 'graphql-config'
import { addHeadersToConfig, IdentityProvider } from './util'

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

  // With different auth providers, we now expect--not require--the IDP (Auth0, or keycloak) serialized in the initial base64 packet.
  // Default to auth0. 
  if( !authConfig.IDP || authConfig.IDP === IdentityProvider.Auth0){
    // Auth0 uses Authentication Code Flow and PKCE, exchanging code for full auth token.
    requestConfig = {
      method: 'POST',
      url: authConfig.url,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: authConfig.id,
        // Use PKCE.
        code_verifier: Buffer.from(authConfig.state, 'base64').toString(),
        code: authConfig.code,
        redirect_uri: authConfig.ruri
      })
    }
    console.log(chalk.green('✔ Configuration set for IDP: auth0'))
  } else if (authConfig.IDP === IdentityProvider.KeyCloak){
    // With keycloak, we do the token exchange externally, and validate the token here. 
    // Send a request to the userinfo endpoint on keycloak.
    // This ensures the token received is valid -- not necessarily of our origin, i.e., this could be spoofed (as could Auth0). 
    // Regardless, this is acceptable (for either IDP flow) since all requests must authenticate through API against auth provider.
    let token = (!authConfig.access_token.startsWith('Bearer ')) 
      ?'Bearer ' + authConfig.access_token
      : token

    requestConfig = {
        method: 'GET',
        url: `${authConfig.url}/auth/realms/${authConfig.realm}/protocol/openid-connect/userinfo`, 
        headers: {
            Authorization: token
        },
    };
    console.log(chalk.green('✔ Configuration set for IDP: keycloak'))
  }else{
    console.log(
      chalk.red(`✘ Cannot sign in with unsupported IDP: ${authConfig.IDP}`)
    )
    return
  }

  // Fetch anything else and persist to config.
  try {

    let response = await request(requestConfig)
    let authInfo

    // Set auth info to Auth0 repsonse, containing token.
    if( !authConfig.IDP || authConfig.IDP === IdentityProvider.Auth0){
      authInfo = JSON.parse(response)
      authInfo.expires_at = Date.now() + authInfo.expires_in * 1000
      authInfo.url = authConfig.url
      authInfo.id = authConfig.id
    }
    // For keycloak, use what's in the authconfig that we validated.
    else if(authConfig.IDP === IdentityProvider.KeyCloak){
      authInfo = authConfig
      // Expiry, url, and id are expected in incoming base64 package. 
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
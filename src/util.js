import fs from 'fs-extra'
import path from 'path'
import chalk from 'chalk'
import { buildASTSchema, parse } from 'graphql'

//
// String utilities
//

// Ensure initial letter is capitalized
export const capitalize = word => word[0].toUpperCase() + word.substr(1)

// Strip newlines from string
export const stripCRLF = s => s.replace(/\r?\n|\r/g, '')

// Truncate text with an ellipse
export const ellipse = (str, max = 200) => {
  if (str.length > max) {
    return str.substring(0, max) + '...'
  }
  return str
}

/**
 * Update the set of values for this indexed collection
 */
export const append = (obj, k, v) => {
  let e = obj[k]
  if (!e || e.length === 0) obj[k] = e = []
  e.push(v)
  return e
}

//
// Object utilities
//
/**
 * Ensure an entry exists in a dictionary
 */
export const getOrSet = (obj, k, v) => {
  let e = obj[k]
  if (!e) obj[k] = e = v
  return e
}

/**
 * Emptiness test
 */
export const isNullOrEmpty = obj => {
  if (obj === null || obj === undefined) return true

  const type = typeof obj
  if (type === 'object') {
    if (Array.isArray(obj)) {
      return obj.length === 0
    }
    return Object.keys(obj).length === 0
  }

  if (type === 'string') {
    return obj === ''
  }

  return false
}

//
// File utilities
//

/**
 * Find all files inside a dir, recursively.
 * @param  {string} dir Dir path string.
 * @return {string[]} Array with all file names that are inside the directory.
 */
export const getAllFiles = dir =>
  fs.readdirSync(dir).reduce((files, file) => {
    const name = path.join(dir, file)
    const isDirectory = fs.statSync(name).isDirectory()
    return isDirectory ? [...files, ...getAllFiles(name)] : [...files, name]
  }, [])

/**
 * Synchronously read an entire UTF-8 encoded file, stripping initial BOM
 * code, if present
 * @param {file} file
 * @return {text}
 */
export const readFile = file => {
  if (!file) {
    throw new Error('No file specifed for read')
  }

  let text = fs.readFileSync(file, 'utf-8')
  if (!text) {
    throw new Error(`No text in file: ${file}`)
  }

  // Catches EFBBBF (UTF-8 BOM) because the buffer-to-string
  // conversion translates it to FEFF (UTF-16 BOM)
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1)
  }

  // console.log(chalk.green(`Read file: ${file} size: ${text.length}`));
  return text
}

export const readJson = file => {
  return parseJson(readFile(file))
}

export const parseJson = str => {
  try {
    return JSON.parse(str)
  } catch (e) {
    throw new Error(`Error parsing ${ellipse(str)} as JSON: ${e}`)
  }
}

//
// GraphQL communication utilities
//

export const getEndpoint = (config, argv) => {
  const extensions = config.extensions || {}
  const endpoints = extensions.endpoints || {}

  const key = argv.endpoint || Object.keys(endpoints)[0]
  if (!key) {
    return console.log(chalk.red(`No endpoint found.`))
  }
  var endpoint = config.endpointsExtension.getEndpoint(key)
  if (!endpoint) {
    return console.log(chalk.red(`No endpoint ${key} found.`))
  }
  if (typeof endpoint === 'string') {
    endpoint = { url: endpoint }
  }
  console.log(chalk.green(`Using endpoint ${key}: ${endpoint.url}`))
  return endpoint
}

/**
 * Adds the headers used in requests to the Maana API
 *
 * @param {Object} config to update
 */
export function addHeadersToConfig(config) {
  if (config.projects) {
    Object.values(config.projects).forEach(addHeadersToConfig)
    return
  }

  if (config.extensions && config.extensions.endpoints) {
    const endpoints = config.extensions.endpoints
    Object.keys(endpoints).forEach(name => {
      let result = {}
      if (typeof endpoints[name] === 'string') {
        result.url = endpoints[name]
        result.headers = {}
      } else {
        result = endpoints[name]
        if (!result.headers) {
          result.headers = {}
        }
      }
      result.headers.Authorization = 'Bearer ${env:MAANA_AUTH_TOKEN}'
      endpoints[name] = result
    })
  }
}

/**
 * Get the GraphQL schema for the project
 *
 * @param {*} config
 */
export const getSchema = config => {
  const schemaPath = config.schemaPath
  const schemaContents = fs.readFileSync(schemaPath).toString()
  return buildASTSchema(parse(schemaContents))
}

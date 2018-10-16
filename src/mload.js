import { getNamedType, isListType, isNonNullType, isObjectType } from 'graphql'
import papa from 'papaparse'
import fs from 'fs-extra'
import path from 'path'
import chalk from 'chalk'
import mkdirp from 'mkdirp'
import md5Base64 from 'md5-base64'
import moment from 'moment'

import {
  capitalize,
  ellipse,
  getAllFiles,
  getEndpoint,
  getSchema,
  isNullOrEmpty,
  parseTime,
  readFile,
  readJson
} from './util'

const DEFAULT_BATCH_SIZE = 1000000

/**
 * Plugin boilerplate
 */
export const command = 'mload <fileOrDir>'
export const desc = 'Load a file or directory tree into Maana Q'
export const builder = {
  mutation: {
    alias: 'm',
    description: 'mutation to call'
  },
  type: {
    alias: 't',
    description: 'type of entities (e.g., Person)'
  },
  ndfout: {
    alias: 'n',
    description: 'directory to store NDF conversion of input'
  },
  endpoint: {
    alias: 'e',
    description: 'endpoint to use'
  },
  batchsize: {
    alias: 'b',
    description: 'max records to send at once'
  }
}

/**
 * A collection of the different results while processing and uploading the
 * files so we can build a report for the user at the end of the command.
 */
const fileResults = {
  ndfGenCnt: 0, // # of "generations" (based on file flushes)
  ndfFileCnt: 0, // how many NDF files were written
  succeed: 0,
  total: 0,
  errors: { mutation: [], dataRead: [], uploading: {}, ndf: [] }
}

/**
 * NDF ids are CHAR(25), so we translate all original ID references to conform
 */
const mkNdfId = id => (id.length > 25 ? md5Base64(id).slice(0, -2) : id)

/**
 *
 * @param {*} type
 */
const typeIsList = type => {
  let isList = false
  if (type.name && type.name.endsWith('Connection')) {
    isList = true
  }
  while (
    !isList &&
    (isListType(type) ||
      isNonNullType(type) ||
      type.kind === 'NON_NULL' ||
      type.kind === 'LIST')
  ) {
    if (isListType(type) || type.kind === 'LIST') {
      isList = true
      break
    }
    type = type.ofType
  }
  return isList
}

/**
 * Read and parse a CSV file
 *
 * @param {*} context
 * @param {Path} parsedPath
 */
const readCsvFile = (context, parsedPath) => {
  const filePath = path.format(parsedPath)
  context.spinner.start(`Parsing CSV file ${chalk.yellow(filePath)}`)

  try {
    const text = readFile(filePath)

    // Parse the whole file (may need to be smarter about this in the future...)
    const parsedCsv = papa.parse(text, { header: true, skipEmptyLines: true })
    if (parsedCsv.meta.aborted) {
      throw new Error(
        `Error parsing CSV file ${filePath} rows: ${
          parsedCsv.data.length
        } errors: ${JSON.stringify(parsedCsv.errors)} meta: ${JSON.stringify(
          parsedCsv.meta
        )}`
      )
    }

    context.spinner.succeed(
      chalk.green(
        `Parsed ${chalk.yellow(filePath)} entities: ${chalk.yellow(
          parsedCsv.data.length
        )} meta: ${chalk.yellow(JSON.stringify(parsedCsv.meta))}`
      )
    )
    if (parsedCsv.errors && parsedCsv.errors.length) {
      console.log(
        chalk.red(
          `✘ Parse errors (${chalk.yellow(parsedCsv.errors.length)}): ${ellipse(
            JSON.stringify(parsedCsv.errors, null, 2),
            500
          )}`
        )
      )
    }
    return parsedCsv.data
  } catch (error) {
    context.spinner.fail(chalk.red(error))
  }
}

/**
 * Read and parse a JSON file
 *
 * @param {*} context
 * @param {Path} parsedPath
 */
const readJsonFile = (context, parsedPath) => {
  const filePath = path.format(parsedPath)

  context.spinner.start(`Parsing JSON file ${chalk.yellow(filePath)}`)

  try {
    const json = readJson(filePath)
    const entityCnt = Array.isArray(json) ? json.length : 1
    context.spinner.succeed(
      chalk.green(
        `Done parsing JSON file ${chalk.yellow(
          filePath
        )} entities: ${chalk.yellow(entityCnt)}`
      )
    )
    if (entityCnt === 1 && !Array.isArray(json)) return [json]
    return json
  } catch (error) {
    context.spinner.fail(chalk.red(error))
  }
}

/**
 * Read ALL of the data into memory
 * @@TODO: streaming interface
 *
 * @param {*} context
 * @param {Path} parsedPath
 */
const readData = (context, parsedPath) => {
  const ext = parsedPath.ext
  switch (ext) {
    case '.csv':
    case '.tsv':
    case '.dat':
      return readCsvFile(context, parsedPath)
    case '.json':
      return readJsonFile(context, parsedPath)
    default:
      return null // should be unreachable
  }
}

/**
 * Type cache to speed lookups
 */
const typeCache = {}

/**
 * Get the GraphQL field definition from a type
 *
 * @param {*} type
 * @param {String} fieldName
 */
const getField = (type, fieldName) => {
  const key = `${type.name}.${fieldName}`
  // console.log("key", key);

  let entry = typeCache[key]
  if (!entry) {
    const fields = type.getFields()
    const field = fields ? fields[fieldName] : undefined
    if (!field) {
      const msg = `Undefined field: ${chalk.yellow(fieldName)}`
      console.log(chalk.red(`✘ ${msg}`))
      throw msg
    }
    // console.log("field", field);

    // console.log("Field:", key);

    const namedType = getNamedType(field.type)
    // console.log("- namedType:", namedType.name);

    const isList = typeIsList(field.type)
    // console.log("- isList:", isList);

    const isNonNull = isNonNullType(field.type)
    // console.log("- isNonNull:", isNonNull);

    const isObject = isObjectType(namedType)
    // console.log("- isObject:", isObject);

    entry = { field, isList, isNonNull, isObject, namedType }

    typeCache[key] = entry
  }
  return entry
}

/**
 * Get the named mutation field from the GraphQL schema
 *
 * @param {*} schema
 * @param {*} mutationName
 */
const getMutationField = (schema, mutationName) => {
  const mutationType = schema.getMutationType()
  if (!mutationType) {
    return console.log(chalk.red(`✘ No mutation type in schema.`))
  }
  const fields = mutationType.getFields()
  const mutationField = fields[mutationName]
  if (!mutationField) {
    return console.log(
      chalk.red(`✘ Mutation for "${chalk.yellow(mutationName)}" not found.`)
    )
  }
  console.log(
    `Using mutation ${chalk.yellow(mutationField.name)}: ${chalk.yellow(
      mutationField.description || '(no description)'
    )}`
  )
  return mutationField
}

/**
 * Get the input (argument) type for the GraphQL mutation
 *
 * @param {*} schema
 * @param {*} mutationField
 */
const getInputTypeDef = (schema, mutationField) => {
  // Find the 'input' argument, if any
  const inputs = mutationField.args.filter(x => x.name === 'input')
  if (!inputs || inputs.length !== 1) {
    return console.log(
      chalk.red(
        `✘ Input argument missing for ${chalk.yellow(mutationField.name)}.`
      )
    )
  }
  const inputType = inputs[0].type

  // Get the underlying type name (i.e., strip '!' and '[]')
  const namedType = getNamedType(inputs[0].type)

  // Get the actual type definition from the schema
  const typeDef = schema.getType(namedType)

  console.log(
    `Input type ${chalk.yellow(typeDef.name)}: ${chalk.yellow(
      typeDef.description || '(no description)'
    )}`
  )

  return { inputType, typeDef }
}

/**
 * Coerce the input type to match the output type
 *
 * @param {*} type
 * @param {*} val
 * @param {*} def
 */
const coerce = ({ type, val, def = null, quoted = false, isoDate = false }) => {
  let rval = def

  if (type == 'Float') {
    if (typeof val == 'string') {
      rval = Number(val)
      if (isNaN(rval)) {
        console.log(
          chalk.yellow(
            `✘ Was not able to coerce Float from String--"${chalk.red(
              val
            )}": Not a number (NaN).`
          )
        )
        rval = def
      }
    } else if (typeof val == 'number') {
      rval = val
    }
  } else if (type == 'Int') {
    if (typeof val == 'string') {
      rval = Number(val)
      if (isNaN(rval)) {
        console.log(
          chalk.yellow(
            `✘ Was not able to coerce Int from String--"${chalk.red(
              val
            )}": Not a number (NaN).`
          )
        )
        rval = def
      }
    } else if (typeof val == 'number') {
      rval = val
    }
  } else if (type == 'Boolean') {
    if (typeof val == 'string') {
      const lcVal = val.toLowerCase()
      if (lcVal == 'true') {
        rval = true
      } else if (lcVal == 'false') {
        rval = false
      }
    } else if (typeof val == 'boolean') {
      rval = val
    }
  } else if (type == 'Date' || type == 'DateTime' || type == 'Time') {
    const cvtDate = () => {
      let dateStr
      if (type == 'Time') {
        const date = parseTime(val)
        if (isNaN(date)) throw new Error(`Invalid time: ${val}`)
        dateStr = val
      } else {
        const date = moment(val)
        if (!date.isValid()) throw new Error(`Invalid date/time: ${val}`)
        if ((type == 'Date' && isoDate) || type == 'DateTime') {
          dateStr = date.toISOString()
        } else if (type == 'Date') {
          dateStr = date.format('YYYY-MM-DD')
        }
      }
      if (quoted) dateStr = `"${dateStr}"`
      return dateStr
    }
    rval = !val || val == '' ? def : cvtDate()
  } else if (!quoted && typeof val == 'string') {
    rval = val
  } else {
    rval = JSON.stringify(val)
  }

  // console.log("type", type, "rval", rval, "quoted", quoted);
  return rval
}

/**
 * Generate the full mutation to upload based on the data
 *
 * @param {*} mutationField
 * @param {*} inputType
 * @param {*} data
 */
const buildMutation = (mutationField, inputType, typeDef, data) => {
  // console.log("data", data);
  const instances = data.map(row => {
    try {
      const fields = Object.keys(row)
        .map(fieldName => {
          const value = row[fieldName]

          const { field, isList, isNonNull, namedType } = getField(
            typeDef,
            fieldName
          )

          const valueType = typeof value
          // console.log("valueType", valueType);

          if (Array.isArray(value)) {
            if (!isList) {
              const msg = `Unexpected collection for ${chalk.yellow(
                fieldName
              )}: ${chalk.yellow(field.type)} => ${chalk.yellow(
                JSON.stringify(value)
              )}`
              console.log(chalk.red(`✘ ${msg}`))
              throw msg
            }

            if (value.length === 0) {
              return `${fieldName}: null`
            }
            const values = value.map(v =>
              coerce({ type: namedType, val: v, quoted: true })
            )
            return `${fieldName}: [${values.join(',')}]`
          } else if (isList) {
            const msg = `Expected collection for ${chalk.yellow(fieldName)}: ${
              field.type
            } => ${JSON.stringify(value)}`
            console.log(chalk.red(`✘ ${msg}`))
            throw msg
          }
          return `${fieldName}: ${coerce({
            type: namedType,
            val: value,
            quoted: true
          })}\n`
        })
        .join(',')
      return `{${fields}}`
    } catch (error) {
      console.log(chalk.red(`✘ ${error}`))
    }
  })

  // Handle list input type
  if (typeIsList(inputType)) {
    const list = instances.join(', ')
    const mutation = `mutation { ${mutationField.name}(input:[${list}]) }`
    return mutation
  }

  // Single input type
  const mutations = instances
    .map((instance, idx) => {
      return `m${idx}: ${mutationField.name}(input:${instance})`
    })
    .join('\n')
  return `mutation { ${mutations} }`
}

/**
 * File load dispatcher: NDF conversion or upload via mutation
 *
 * @param {*} context
 * @param {*} filePath
 */
const load = async (context, filePath) => {
  // console.log("filePath", filePath);

  // Parse the path into its components
  const parsedPath = path.parse(filePath)
  // console.log("parsedPath", parsedPath);

  // Only accept supported file types
  const ext = parsedPath.ext.toLowerCase()
  switch (ext) {
    case '.csv':
    case '.tsv':
    case '.dat':
      break
    case '.json':
      break
    default:
      // console.log(chalk.yellow(`skipping unsupported file type: ${filePath}`));
      return
  }

  fileResults.total++

  // Dispatch to the right operation:
  // - convert input to NDF
  // - upload entities via mutation

  // The simple test is: if an NDF output directory was specified, then we
  // are performing a conversion, otherwise we are uploading via mutation
  const ndfout = context.argv.ndfout
  if (ndfout) return convertToNdf(context, parsedPath)
  return uploadViaMutation(context, parsedPath)
}

/**
 * NDF conversion
 */
const convertToNdf = async (context, parsedPath) => {
  // Construct string version of file path
  const filePath = path.format(parsedPath)
  context.spinner.start(`Converting ${chalk.yellow(filePath)}`)

  // Get the NDF output directory
  const ndfOut = context.argv.ndfout
  const ndfPath = path.isAbsolute(ndfOut)
    ? ndfOut
    : path.resolve(process.cwd(), ndfOut)
  // console.log('ndfPath', ndfPath)

  // Infer the typenaame
  const typeName = context.argv.type || parsedPath.name
  // console.log('typeName', typeName)

  // Get the GraphQL type definition
  const baseType = context.schema.getType(typeName)
  if (!baseType) {
    fileResults.errors.ndf.push({
      file: filePath,
      msg: `type not found in schema: ${typeName}`
    })
    return
  }
  // console.log(
  //   `Base type ${chalk.yellow(baseType.name)}: ${chalk.yellow(
  //     baseType.description || '(no description)'
  //   )}`
  // )

  // Ensure the type has an id field
  const idFieldInfo = getField(baseType, 'id')
  if (!idFieldInfo) {
    fileResults.errors.ndf.push({
      file: filePath,
      msg: `type has no id field: ${typeName}`
    })
    return
  }

  // Read the data
  // @@TODO: streaming
  const data = readData(context, parsedPath)
  if (!data) {
    fileResults.errors.dataRead.push({ file: filePath })
    return
  }
  // console.log('data', data)

  // Build internal state (resettable) for the different NDF value types
  let nodes = []
  let lists = []
  let relations = []

  const flush = () => {
    // Any output to produce?
    if (
      isNullOrEmpty(nodes) &&
      isNullOrEmpty(lists) &&
      isNullOrEmpty(relations)
    )
      return

    fileResults.ndfGenCnt++
    const outName = `${fileResults.ndfGenCnt}`.padStart(5, '0')

    if (!isNullOrEmpty(nodes)) {
      writeNdfFile(ndfPath, 'nodes', outName, nodes)
      nodes = []
      fileResults.ndfFileCnt++
    }

    if (!isNullOrEmpty(lists)) {
      writeNdfFile(ndfPath, 'lists', outName, lists)
      lists = []
      fileResults.ndfFileCnt++
    }

    if (!isNullOrEmpty(relations)) {
      writeNdfFile(ndfPath, 'relations', outName, relations)
      relations = []
      fileResults.ndfFileCnt++
    }
  }

  // Stats
  let entityCnt = 0
  let errorCnt = 0

  // Don't allow duplicate records
  const dedupe = {}

  data.forEach(entity => {
    // console.log('entity', entity)

    if (!entity.id) {
      fileResults.errors.ndf.push({
        file: filePath,
        msg: `entity missing id: ${JSON.stringify(entity)}`
      })
      errorCnt++
      return
    }

    // Make a NDF-compliant ID
    const id = mkNdfId(entity.id)

    // Dedupe
    if (dedupe[id]) {
      fileResults.errors.ndf.push({
        file: filePath,
        msg: `duplicate id: ${entity.id} => ${dedupe[id]}`
      })
      errorCnt++
      return
    }
    dedupe[id] = entity.id

    // Intermediate state for this entity
    const nodeValues = {}
    const listValues = {}
    const relValues = {}

    // Process all the fields
    Object.keys(entity)
      .filter(x => x != 'id')
      .forEach(fieldName => {
        const fieldRes = getField(baseType, fieldName)
        // console.log('field', fieldName, fieldRes)

        const { field, isList, isNonNull, isObject, namedType } = fieldRes

        // What type of field is it?
        if (isList) {
          if (isObject) {
            // add a list of relations
            // add a list of values
            relValues[fieldName] = {
              toType: namedType.name,
              toIds: entity[fieldName].map(mkNdfId)
            }
          } else {
            // add a list of values
            listValues[fieldName] =
              namedType.name === 'ID'
                ? mkNdfId(entity[fieldName])
                : entity[fieldName]
          }
        } else if (isObject) {
          // add a relation
          relValues[fieldName] = {
            toType: namedType.name,
            toIds: [mkNdfId(entity[fieldName])]
          } // always a collection
        } else {
          // add a value
          const value =
            namedType.name === 'ID'
              ? mkNdfId(entity[fieldName])
              : coerce({
                  type: namedType.name,
                  val: entity[fieldName],
                  isoDate: true
                })

          if (value != null && value != undefined) {
            nodeValues[fieldName] = value
          }
        }
      })

    // Generate output for this entity
    // ... add the set of leaf field values
    nodes.push({ _typeName: typeName, id, ...nodeValues })

    if (!isNullOrEmpty(listValues)) {
      // add the set of list field values (i.e., lists)
      lists.push({ _typeName: typeName, id, ...listValues })
    }

    if (!isNullOrEmpty(relValues)) {
      // add the relationship pairs
      Object.keys(relValues).forEach(fieldName => {
        const relValue = relValues[fieldName]

        relValue.toIds.forEach(toId => {
          relations.push([
            { _typeName: typeName, id, fieldName },
            { _typeName: relValue.toType, id: toId }
          ])
        })
      })
    }

    entityCnt++
    if (entityCnt % 10000 === 0) flush()
  }) // entity loop

  flush()

  if (!errorCnt) {
    fileResults.succeed++
    context.spinner.succeed(
      chalk.green(`Converted ${chalk.yellow(filePath)} without errors`)
    )
  } else {
    context.spinner.fail(
      chalk.red(`✘ Converted ${chalk.yellow(filePath)} with ${errorCnt} errors`)
    )
  }
}

/**
 * Write data to one of the NDF file types
 *
 * @param {*} ndfPath
 * @param {*} valueType
 * @param {*} typeName
 * @param {*} values
 */
const writeNdfFile = (ndfPath, valueType, typeName, values) => {
  const outName = `${typeName}.json`
  // console.log("outName", outName);

  const outDir = path.resolve(ndfPath, valueType)
  // console.log("outdir", outDir);

  // Ensure the output path exists
  mkdirp.sync(outDir)

  const outPath = path.resolve(outDir, outName)
  // console.log("outpath", outPath);

  const data = JSON.stringify(
    {
      valueType,
      values
    },
    null,
    2
  )

  fs.writeFileSync(outPath, data, 'utf8')
}

/**
 * Upload entities via mutation
 */
const uploadViaMutation = async (context, parsedPath) => {
  // Generate a mutation name from base name
  const genMutationName = baseName => `add${baseName}s`

  // Infer the mutation
  const mutationName = context.argv.mutation || genMutationName(parsedPath.name)
  // console.log("useMutationName", useMutationName);

  // Construct string version of file path
  const filePath = path.format(parsedPath)

  const mutationField = getMutationField(context.schema, mutationName)
  if (!mutationField) {
    fileResults.errors.mutation.push({
      file: filePath,
      mutation: mutationName
    })
    return
  }
  // console.log("mutationField", mutationField);

  const { inputType, typeDef } = getInputTypeDef(context.schema, mutationField)
  if (!inputType) {
    fileResults.errors.mutation.push({
      file: filePath,
      mutation: mutationName
    })
    return
  }
  // console.log("inputType", inputType);
  // console.log("inputType fields", inputType.getFields());

  // Read the data
  // @@TODO: streaming
  const data = readData(context, parsedPath)
  if (!data) {
    fileResults.errors.dataRead.push({ file: filePath })
    return
  }

  let offset = 0
  const batchSize = context.argv.batchsize || DEFAULT_BATCH_SIZE
  // console.log("batchSize", batchSize);

  const totalLength = data.length
  while (offset < totalLength) {
    let end = offset + batchSize
    if (end > totalLength) {
      end = totalLength
    }
    const batch = data.slice(offset, end)

    let mutation
    try {
      mutation = buildMutation(mutationField, inputType, typeDef, batch)
    } catch (error) {
      fileResults.errors.mutation.push({
        file: filePath,
        mutation: mutationName
      })
      return
    }
    if (!mutation) {
      fileResults.errors.mutation.push({
        file: filePath,
        mutation: mutationName
      })
      return
    }
    // console.log('mutation', mutation)

    const incErrors = () => {
      if (!fileResults.errors.uploading[filePath]) {
        fileResults.errors.uploading[filePath] = 0
      }
      fileResults.errors.uploading[filePath]++
    }

    try {
      if ((offset === 0 && totalLength > end) || offset > 0) {
        context.spinner.start(
          chalk.yellow(`Uploading batch ${offset}-${end} of ${totalLength}`)
        )
      } else {
        context.spinner.start(chalk.yellow(`Uploading`))
      }
      const result = await context.client.request(mutation)
      // console.log("result", result);
      if (result['errors']) {
        context.spinner.fail(
          chalk.red(`Call failed: ${JSON.stringify(result['errors'])}`)
        )
        incErrors()
      } else {
        const nulls = Object.keys(result).filter(x => result[x] === null)
        if (nulls.length === 0) {
          context.spinner.succeed(
            chalk.green(
              `Call succeeded: ${chalk.yellow(ellipse(JSON.stringify(result)))}`
            )
          )
        } else {
          const total = Object.keys(result).length
          context.spinner.succeed(
            chalk.green(
              `${nulls.length} out of ${total} mutations changed nothing`
            )
          )
        }
      }
    } catch (error) {
      let msg
      if (typeof error === 'object') {
        const response = error.response
        if (response.error) {
          msg = `GraphQL Error: ${response.error || '(none)'}, status: ${
            response.status
          }`
        } else if (response.errors) {
          const errMsgs = response.errors.map(e => ellipse(e.message, 2000))
          if (errMsgs.length === 1) {
            msg = errMsgs[0]
          } else {
            msg = `[${errMsgs.join(',\n')}]`
          }
        } else {
          msg = ellipse(JSON.stringify(error), 2000)
        }
      } else if (typeof error === 'string') {
        msg = error
      }
      context.spinner.fail(chalk.red(`Exception: ${chalk.yellow(msg)}`))

      incErrors()
    }

    offset += batchSize
  }

  if (!fileResults.errors.uploading[filePath]) {
    fileResults.succeed++
  }
}

/**
 * Main command handler
 *
 * @param {*} context
 * @param {*} argv
 */
export const handler = async (context, argv) => {
  // Capture the arguments
  context.argv = argv
  // console.log("argv", argv);

  // Get the project level configuration from .graphqlconfig
  const config = await context.getProjectConfig()
  // console.log("config", config);

  // Given the configuration and the arguments, what endpoint do we use?
  context.endpoint = getEndpoint(config, argv)
  if (!context.endpoint) return

  // Given the endpoint, what is the client we are using
  context.client = context.endpoint.getClient()

  // This is the schema string
  // const schemaSDL = config.getSchemaSDL();
  // console.log("schemaSDL", schemaSDL);

  // Load the project's schema (AST)
  context.schema = getSchema(config)
  // console.log("schema", schema);

  // const configPath = config.configPath;
  // console.log("configPath", configPath);

  // Load the project's extensions
  context.extensions = config.extensions || {}
  // console.log("extensions", context.extensions);

  // Load the project's default Maana options
  context.options = context.extensions.maana || {}
  // console.log("options", context.options);

  // What are we loading?
  const fileOrDir = argv.fileOrDir
  if (!fileOrDir) {
    return console.log(chalk.red(`✘ Must specify a file or directory`))
  }

  // Are we processing an entire folder?
  if (fs.lstatSync(fileOrDir).isDirectory()) {
    // Get the set of files
    const filePaths = getAllFiles(fileOrDir)

    // Iterate SEQUENTIALLY over all the files (recursively) in the folder tree rooted at 'folder'
    for (let i = 0; i < filePaths.length; i++) {
      await load(context, filePaths[i])
    }
  } else {
    await load(context, fileOrDir)
  }

  // output the results from processing and uploading the files
  buildReport()
}

/**
 * Generate a report of actions and errors
 */
const DIVIDER =
  '-------------------------------------------------------------------------------'

const buildReport = () => {
  // NDF conversion stats
  if (fileResults.ndfFileCnt > 0) {
    console.log(chalk.green(DIVIDER))
    console.log('NDF Conversion:')

    console.log(
      chalk.green(
        `✔ Files processed    : ${chalk.yellow(`${fileResults.total}`)}` // assume we only did conversion
      )
    )
    console.log(
      chalk.green(
        `✔ Generations        : ${chalk.yellow(`${fileResults.ndfGenCnt}`)}`
      )
    )
    console.log(
      chalk.green(
        `✔ NDF files generated: ${chalk.yellow(`${fileResults.ndfFileCnt}`)}`
      )
    )
  }

  // let the user know how many files had no issues
  if (fileResults.succeed) {
    console.log(chalk.green(DIVIDER))
    console.log(
      chalk.green(
        `✔ ${fileResults.succeed} of ${fileResults.total} file(s) succeeded`
      )
    )
  }

  // figure out how many errors we have
  const uploadErrorKeys = Object.keys(fileResults.errors.uploading)
  const numErrors =
    uploadErrorKeys.length +
    fileResults.errors.mutation.length +
    fileResults.errors.dataRead.length +
    fileResults.errors.ndf.length

  // only show information about errors if there are any
  if (numErrors) {
    // deliver the sad news
    console.log(chalk.red(DIVIDER))

    // let the user know the total number of files that had issues
    console.log(chalk.red(`✘ ${numErrors} issue(s):`))

    // tell the user about NDF conversion issues
    if (fileResults.errors.ndf.length) {
      console.log(
        chalk.red(`  ${fileResults.errors.ndf.length} NDF conversion`)
      )
      fileResults.errors.ndf.forEach(e =>
        console.log(`    ${chalk.yellow(e.file)}: ${chalk.red(e.msg)}`)
      )
    }

    // tell the user about issues with mutations
    if (fileResults.errors.mutation.length) {
      console.log(
        chalk.red(
          `  ${
            fileResults.errors.mutation.length
          } file(s) had issues finding or creating the mutation`
        )
      )
      fileResults.errors.mutation.forEach(e =>
        console.log(
          `    ${chalk.yellow('File')} ${e.file} ${chalk.yellow(
            'with mutation'
          )} ${e.mutation}`
        )
      )
    }

    // tell the user about issues with reading the data off the disk
    if (fileResults.errors.dataRead.length) {
      console.log(
        chalk.red(
          `  ${
            fileResults.errors.dataRead.length
          } file(s) had issues loading the data from disk`
        )
      )
      fileResults.errors.dataRead.forEach(e =>
        console.log(`    ${chalk.yellow('File')} ${e.file}`)
      )
    }

    // tell the user about issues uploading the data
    if (uploadErrorKeys.length) {
      console.log(
        chalk.red(
          `  ${uploadErrorKeys.length} file(s) had issues uploading data`
        )
      )
      uploadErrorKeys.forEach(file =>
        console.log(
          `    ${chalk.yellow('File')} ${file} ${chalk.yellow('in')} ${
            fileResults.errors.uploading[file]
          } ${chalk.yellow('batch(es)')}`
        )
      )
    }

    // let the user know how to find more information about the issues
    console.log(chalk.red(DIVIDER))
    console.log(
      chalk.red(
        'For more information on the errors, please look through the full output of the command'
      )
    )
  } else {
    // let the user know that no issues happened during the command
    console.log(chalk.green(DIVIDER))
    console.log(chalk.green('✔ No errors'))
  }
}

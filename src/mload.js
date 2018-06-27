import {
  buildASTSchema,
  parse,
  GraphQLSchema,
  GraphQLObjectType,
  graphql,
  getNamedType,
  isListType,
  isNonNullType,
  GraphQLNonNull,
  GraphQLID
} from "graphql";
import papa from "papaparse";
import fs from "fs-extra";
import path from "path";
import chalk from "chalk";
import mkdirp from "async-mkdirp";
import hash from "string-hash";

import {
  capitalize,
  ellipse,
  getAllFiles,
  getEndpoint,
  isNullOrEmpty,
  readFile,
  readJson
} from "./util";

const DEFAULT_BATCH_SIZE = 1000000;

const SupportedTypes = [".csv", ".json"]; // NOTE: all lowercase!

/**
 * Plugin boilerplate
 */
export const command = "mload <fileOrDir>";
export const desc = "Load a file or directory tree into Maana Q";
export const builder = {
  mutation: {
    alias: "m",
    description: "mutation to call (must take an array of instances)"
  },
  type: {
    alias: "t",
    description: "type of entities (e.g., Person)"
  },
  ndfout: {
    alias: "n",
    description: "directory to store NDF conversion of input"
  },
  endpoint: {
    alias: "e",
    description: "endpoint to use"
  },
  batchsize: {
    alias: "b",
    description: "max records to send at once"
  }
};

/**
 * A collection of the different results while processing and uploading the
 * files so we can build a report for the user at the end of the command.
 */
const fileResults = {
  succeed: 0,
  total: 0,
  errors: { mutation: [], dataRead: [], uploading: {} }
};

/**
 * NDF output file counter
 */
let ndfFileCount = 0;

/**
 * Get the GraphQL schema for the project
 *
 * @param {*} config
 */
const getSchema = config => {
  const schemaPath = config.schemaPath;
  const schemaContents = fs.readFileSync(schemaPath).toString();
  return buildASTSchema(parse(schemaContents));
};

/**
 * Read and parse a CSV file
 *
 * @param {*} context
 * @param {Path} parsedPath
 */
const readCsvFile = (context, parsedPath) => {
  const filePath = path.format(parsedPath);
  context.spinner.start(`Parsing CSV file ${chalk.yellow(filePath)}`);

  try {
    const text = readFile(filePath);

    // Parse the whole file (may need to be smarter about this in the future...)
    const parsedCsv = papa.parse(text, { header: true, skipEmptyLines: true });
    if (parsedCsv.meta.aborted) {
      throw new Error(
        `Error parsing CSV file ${filePath} rows: ${
          parsedCsv.data.length
        } errors: ${JSON.stringify(parsedCsv.errors)} meta: ${JSON.stringify(
          parsedCsv.meta
        )}`
      );
    }
    context.spinner.succeed(
      chalk.green(
        `Done parsing CSV file ${chalk.yellow(
          filePath
        )} entities: ${chalk.yellow(
          parsedCsv.data.length
        )} meta: ${chalk.yellow(JSON.stringify(parsedCsv.meta))}`
      )
    );
    return parsedCsv.data;
  } catch (error) {
    context.spinner.fail(chalk.red(error));
  }
};

/**
 * Read and parse a JSON file
 *
 * @param {*} context
 * @param {Path} parsedPath
 */
const readJsonFile = (context, parsedPath) => {
  const filePath = path.format(parsedPath);

  context.spinner.start(`Parsing JSON file ${chalk.yellow(filePath)}`);

  try {
    const json = readJson(filePath);
    context.spinner.succeed(
      chalk.green(
        `Done parsing JSON file ${chalk.yellow(
          filePath
        )} entities: ${chalk.yellow(Object.keys(json).length)}`
      )
    );
    return json;
  } catch (error) {
    context.spinner.fail(chalk.red(error));
  }
};

/**
 * Read ALL of the data into memory
 * @@TODO: streaming interface
 *
 * @param {*} context
 * @param {Path} parsedPath
 */
const readData = (context, parsedPath) => {
  const ext = parsedPath.ext;
  switch (ext) {
    case ".csv":
      return readCsvFile(context, parsedPath);
    case ".json":
      return readJsonFile(context, parsedPath);
    default:
      return null; // should be unreachable
  }
};

/**
 * Type cache to speed lookups
 */
const typeCache = {};

/**
 * Get the GraphQL field definition from a type
 *
 * @param {*} type
 * @param {String} fieldName
 */
const getField = (type, fieldName) => {
  const key = `${type.name}.${fieldName}`;
  // console.log("key", key);

  let entry = typeCache[key];
  if (!entry) {
    const fields = type.getFields();
    const field = fields ? fields[fieldName] : undefined;
    if (!field) {
      const msg = `Undefined field: ${chalk.yellow(fieldName)}`;
      console.log(chalk.red(`✘ ${msg}`));
      throw msg;
    }
    // console.log("field", field);

    console.log("Field:", key);

    const isList = isListType(field.type);
    console.log("- isList:", isList);

    const isNonNull = isNonNullType(field.type);
    console.log("- isNonNull:", isNonNull);

    const namedType = getNamedType(field.type);
    console.log("- namedType:", namedType);

    entry = { field, isList, isNonNull, namedType };

    typeCache[key] = entry;
  }
  return entry;
};

/**
 * Get the named mutation field from the GraphQL schema
 *
 * @param {*} schema
 * @param {*} mutationName
 */
const getMutationField = (schema, mutationName) => {
  const mutationType = schema.getMutationType();
  if (!mutationType) {
    return console.log(chalk.red(`✘ No mutation type in schema.`));
  }
  const fields = mutationType.getFields();
  const mutationField = fields[mutationName];
  if (!mutationField) {
    return console.log(
      chalk.red(`✘ Mutation for "${chalk.yellow(mutationName)}" not found.`)
    );
  }
  console.log(
    `Using mutation ${chalk.yellow(mutationField.name)}: ${chalk.yellow(
      mutationField.description || "(no description)"
    )}.`
  );
  return mutationField;
};

/**
 * Get the input (argument) type for the GraphQL mutation
 *
 * @param {*} schema
 * @param {*} mutationField
 */
const getInputType = (schema, mutationField) => {
  const inputs = mutationField.args.filter(x => x.name === "input");
  if (!inputs || inputs.length !== 1) {
    return console.log(
      chalk.red(
        `✘ Input argument missing for ${chalk.yellow(mutationField.name)}.`
      )
    );
  }
  const namedType = getNamedType(inputs[0].type);
  const inputType = schema.getType(namedType);
  console.log(
    `Input type ${chalk.yellow(inputType.name)}: ${chalk.yellow(
      inputType.description || "(no description)"
    )}`
  );
  return inputType;
};

/**
 * Coerce the input type to match the output type
 *
 * @param {*} type
 * @param {*} val
 * @param {*} def
 */
const coerce = (type, val, def = null) => {
  let rval = def;

  if (type == "Float") {
    if (typeof val == "string") {
      rval = parseFloat(val);
      if (isNaN(rval)) rval = def;
    } else if (typeof val == "number") {
      rval = val;
    }
  } else if (type == "Int") {
    if (typeof val == "string") {
      rval = parseInt(val);
      if (isNaN(rval)) rval = def;
    } else if (typeof val == "number") {
      rval = val;
    }
  } else if (type == "Boolean") {
    if (typeof val == "string") {
      const lcVal = val.toLowerCase();
      if (lcVal == "true") {
        rval = true;
      } else if (lcVal == "false") {
        rval = false;
      }
    } else if (typeof val == "boolean") {
      rval = val;
    }
  } else if (type == "Date" || type == "DateTime" || type == "Time") {
    // Quoted, not empty
    rval = !val || val == "" ? def : JSON.stringify(val);
  } else {
    // Quoted, empty ok
    rval = JSON.stringify(val);
  }

  // console.log("type", type, "rval", rval);
  return rval;
};

/**
 * Generate the full mutation to upload based on the data
 *
 * @param {*} mutationField
 * @param {*} inputType
 * @param {*} data
 */
const buildMutation = (mutationField, inputType, data) => {
  const instances = data
    .map(row => {
      const fields = Object.keys(row)
        .map(fieldName => {
          const value = row[fieldName];

          const { field, isList, isNonNull, namedType } = getField(
            inputType,
            fieldName
          );

          const valueType = typeof value;
          // console.log("valueType", valueType);

          if (Array.isArray(value)) {
            if (!isList) {
              const msg = `Unexpected collection for ${chalk.yellow(
                fieldName
              )}: ${chalk.yellow(field.type)} => ${chalk.yellow(
                JSON.stringify(value)
              )}`;
              console.log(chalk.red(`✘ ${msg}`));
              throw msg;
            }

            if (value.length === 0) {
              return `${fieldName}: null`;
            }
            const values = value.map(v => coerce(namedType, v));
            return `${fieldName}: [${values.join(",")}]`;
          } else if (isList) {
            const msg = `Expected collection for ${chalk.yellow(fieldName)}: ${
              field.type
            } => ${JSON.stringify(value)}`;
            console.log(chalk.red(`✘ ${msg}`));
            throw msg;
          }
          return `${fieldName}: ${coerce(namedType, value)}\n`;
        })
        .join(",");
      return `{${fields}}`;
    })
    .join(",");
  const mutation = `mutation { ${mutationField.name}(input:[${instances}]) }`;
  // console.log("mutation", mutation);
  return mutation;
};

/**
 * File load dispatcher: NDF conversion or upload via mutation
 *
 * @param {*} context
 * @param {*} filePath
 */
const load = async (context, filePath) => {
  // console.log("filePath", filePath);

  // Parse the path into its components
  const parsedPath = path.parse(filePath);
  // console.log("parsedPath", parsedPath);

  // Only accept supported file types
  const ext = parsedPath.ext.toLowerCase();
  switch (ext) {
    case ".csv":
      break;
    case ".json":
      break;
    default:
      // console.log(chalk.yellow(`skipping unsupported file type: ${filePath}`));
      return;
  }

  fileResults.total++;

  // Dispatch to the right operation:
  // - convert input to NDF
  // - upload entities via mutation

  // The simple test is: if an NDF output directory was specified, then we
  // are performing a conversion, otherwise we are uploading via mutation
  const ndfout = context.argv.ndfout;
  if (ndfout) return convertToNdf(context, parsedPath);
  return uploadViaMutation(context, parsedPath);
};

/**
 * NDF conversion
 */
const convertToNdf = async (context, parsedPath) => {
  // Get the NDF output directory
  const ndfOut = context.argv.ndfout;
  const ndfPath = path.isAbsolute(ndfOut)
    ? ndfOut
    : path.resolve(process.cwd(), ndfOut);
  console.log("ndfPath", ndfPath);

  // Infer the typenaame
  const typeName = context.argv.type || parsedPath.name;
  // console.log("useTypeName", useTypeName);

  // Get the GraphQL type definition
  const baseType = context.schema.getType(typeName);
  if (!baseType) {
    // @@TODO: report
    console.log("type not found", typeName);
    return;
  }
  console.log(
    `Base type ${chalk.yellow(baseType.name)}: ${chalk.yellow(
      baseType.description || "(no description)"
    )}`
  );

  // Ensure the type has an id field
  const idFieldInfo = getField(baseType, "id");
  if (!idFieldInfo) {
    // @@TODO: report
    console.log("type has no id field for ", typeName);
    return;
  }

  // Construct string version of file path
  const filePath = path.format(parsedPath);

  // Read the data
  // @@TODO: streaming
  const data = readData(context, parsedPath);
  if (!data) {
    fileResults.errors.dataRead.push({ file: filePath });
    return;
  }
  // console.log("data", data);

  // Build internal state for the different NDF value types
  const nodes = [];
  const lists = [];
  const relations = [];

  data.forEach(entity => {
    // console.log("entity", entity);

    let id = entity.id;
    if (!id) {
      // @@TODO: report
      console.log("entity missing id", entity);
      return;
    }
    if (id.length > 25) id = `${hash(id)}`;

    const nodeValues = {};
    const listValues = {};

    Object.keys(entity)
      .filter(x => x != "id")
      .forEach(fieldName => {
        // console.log("fieldName", fieldName);

        const { field, isList, isNonNull, namedType } = getField(
          baseType,
          fieldName
        );

        if (isList) {
          // {
          //   "valueType": "lists",
          //   "values": [
          //     {"_typeName": "User", "id": "johndoe", "hobbies": ["Fishing", "Cooking"]},
          //     {"_typeName": "User", "id": "sarahdoe", "hobbies": ["Biking", "Coding"]}
          //   ]
          // }
          listValues[fieldName] = entity[fieldName];
        } else {
          nodeValues[fieldName] = entity[fieldName];
          // {
          //   "valueType": "nodes",
          //   "values": [
          //     {"_typeName": "User", "id": "johndoe", "firstName": "John", "lastName": "Doe"},
          //     {"_typeName": "User", "id": "sarahdoe", "firstName": "Sarah", "lastName": "Doe"}
          //   ]
          // }
        }
      });

    if (!isNullOrEmpty(nodeValues)) {
      nodes.push({ _typeName: typeName, id, ...nodeValues });
    }

    if (!isNullOrEmpty(listValues)) {
      lists.push({ _typeName: typeName, id, ...listValues });
    }
  });

  // Output
  if (
    isNullOrEmpty(nodes) &&
    isNullOrEmpty(lists) &&
    isNullOrEmpty(relations)
  ) {
    // @@TODO: report
    console.log("no output produced for ", parsedPath);
    return;
  }

  ndfFileCount++;
  const outName = `${ndfFileCount}`.padStart(5, "0");
  if (!isNullOrEmpty(nodes)) writeNdfFile(ndfPath, "nodes", outName, nodes);
  if (!isNullOrEmpty(lists)) writeNdfFile(ndfPath, "lists", outName, lists);
  if (!isNullOrEmpty(relations))
    writeNdfFile(ndfPath, "relations", outName, relations);
};

/**
 * Write data to one of the NDF file types
 *
 * @param {*} ndfPath
 * @param {*} valueType
 * @param {*} typeName
 * @param {*} values
 */
const writeNdfFile = async (ndfPath, valueType, typeName, values) => {
  const outName = `${typeName}.json`;
  // console.log("outName", outName);

  const outDir = path.resolve(ndfPath, valueType);
  // console.log("outdir", outDir);

  // Ensure the output path exists
  await mkdirp(outDir);

  const outPath = path.resolve(outDir, outName);
  // console.log("outpath", outPath);

  const data = JSON.stringify({
    valueType,
    values
  });

  await fs.writeFile(outPath, data, "utf8");
};

/**
 * Upload entities via mutation
 */
const uploadViaMutation = async (context, parsedPath) => {
  // Generate a mutation name from base name
  const genMutationName = baseName => `add${capitalize(baseName)}s`;

  // Infer the mutation
  const mutationName =
    context.argv.mutation || genMutationName(parsedPath.name);
  // console.log("useMutationName", useMutationName);

  // Construct string version of file path
  const filePath = path.format(parsedPath);

  const mutationField = getMutationField(context.schema, mutationName);
  if (!mutationField) {
    fileResults.errors.mutation.push({
      file: filePath,
      mutation: mutationName
    });
    return;
  }
  // console.log("mutationField", mutationField);

  const inputType = getInputType(context.schema, mutationField);
  if (!inputType) {
    fileResults.errors.mutation.push({
      file: filePath,
      mutation: mutationName
    });
    return;
  }
  // console.log("inputType", inputType);
  // console.log("inputType fields", inputType.getFields());

  // Read the data
  // @@TODO: streaming
  const data = readData(context, parsedPath);
  if (!data) {
    fileResults.errors.dataRead.push({ file: filePath });
    return;
  }

  let offset = 0;
  const batchSize = context.argv.batchsize || DEFAULT_BATCH_SIZE;
  // console.log("batchSize", batchSize);

  const totalLength = data.length;
  while (offset < totalLength) {
    let end = offset + batchSize;
    if (end > totalLength) {
      end = totalLength;
    }
    const batch = data.slice(offset, end);

    let mutation;
    try {
      mutation = buildMutation(mutationField, inputType, batch);
    } catch {
      fileResults.errors.mutation.push({
        file: filePath,
        mutation: mutationName
      });
      return;
    }
    if (!mutation) {
      fileResults.errors.mutation.push({
        file: filePath,
        mutation: mutationName
      });
      return;
    }

    try {
      if ((offset === 0 && totalLength > end) || offset > 0) {
        context.spinner.start(
          chalk.yellow(`Uploading batch ${offset}-${end} of ${totalLength}`)
        );
      } else {
        context.spinner.start(chalk.yellow(`Uploading`));
      }
      const result = await context.client.request(mutation);
      if (result["errors"]) {
        context.spinner.fail(
          chalk.red(`Call failed: ${JSON.stringify(result["errors"])}`)
        );
      } else {
        context.spinner.succeed(
          chalk.green(
            `Call succeeded: ${chalk.yellow(ellipse(JSON.stringify(result)))}`
          )
        );
      }
    } catch (error) {
      let msg;
      if (typeof error === "object") {
        const response = error.response;
        if (response.error) {
          msg = `GraphQL Error: ${response.error || "(none)"}, status: ${
            response.status
          }`;
        } else if (response.errors) {
          const errMsgs = response.errors.map(e => ellipse(e.message, 75));
          if (errMsgs.length === 1) {
            msg = errMsgs[0];
          } else {
            msg = `[${errMsgs.join(", ")}]`;
          }
        } else {
          msg = ellipse(JSON.stringify(error), 75);
        }
      } else if (typeof error === "string") {
        msg = error;
      }
      context.spinner.fail(chalk.red(`Exception: ${chalk.yellow(msg)}`));

      if (!fileResults.errors.uploading[filePath]) {
        fileResults.errors.uploading[filePath] = 0;
      }
      fileResults.errors.uploading[filePath]++;
    }

    offset += batchSize;
  }

  if (!fileResults.errors.uploading[filePath]) {
    fileResults.succeed++;
  }
};

/**
 * Main command handler
 *
 * @param {*} context
 * @param {*} argv
 */
export const handler = async (context, argv) => {
  // Capture the arguments
  context.argv = argv;
  // console.log("argv", argv);

  // Get the project level configuration from .graphqlconfig
  const config = await context.getProjectConfig();
  // console.log("config", config);

  // Given the configuration and the arguments, what endpoint do we use?
  context.endpoint = getEndpoint(config, argv);
  if (!context.endpoint) return;

  // Given the endpoint, what is the client we are using
  context.client = context.endpoint.getClient();

  // This is the schema string
  // const schemaSDL = config.getSchemaSDL();
  // console.log("schemaSDL", schemaSDL);

  // Load the project's schema (AST)
  context.schema = getSchema(config);
  // console.log("schema", schema);

  // const configPath = config.configPath;
  // console.log("configPath", configPath);

  // Load the project's extensions
  context.extensions = config.extensions || {};
  // console.log("extensions", context.extensions);

  // Load the project's default Maana options
  context.options = context.extensions.maana || {};
  // console.log("options", context.options);

  // What are we loading?
  const fileOrDir = argv.fileOrDir;
  if (!fileOrDir) {
    return console.log(chalk.red(`✘ Must specify a file or directory`));
  }

  // Are we processing an entire folder?
  if (fs.lstatSync(fileOrDir).isDirectory()) {
    // Get the set of files
    const filePaths = getAllFiles(fileOrDir);

    // Iterate SEQUENTIALLY over all the files (recursively) in the folder tree rooted at 'folder'
    for (let i = 0; i < filePaths.length; i++) {
      await load(context, filePaths[i]);
    }
  } else {
    await load(context, fileOrDir);
  }

  // output the results from processing and uploading the files
  buildReport();
};

/**
 * Generate a report of actions and errors
 */
const buildReport = () => {
  // keep the report divided from the rest of the output
  console.log(
    chalk.green("--------------------------------------------------------")
  );

  // figure out how many errors we have
  const uploadErrorKeys = Object.keys(fileResults.errors.uploading);
  const numErrors =
    uploadErrorKeys.length +
    fileResults.errors.mutation.length +
    fileResults.errors.dataRead.length;

  // only show information about errors if there are any
  if (numErrors) {
    // let the user know how many files had no issues
    console.log(
      chalk.green(
        `✔ ${fileResults.succeed} of ${
          fileResults.total
        } json and csv files uploaded successfully`
      )
    );

    // let the user know the total number of files that had issues
    console.log(
      chalk.red(`✘ ${numErrors} of ${fileResults.total} files had issues:`)
    );

    // tell the user about issues with mutations
    if (fileResults.errors.mutation.length) {
      console.log(
        chalk.red(
          `  ${
            fileResults.errors.mutation.length
          } had issues finding or creating the mutation`
        )
      );
      fileResults.errors.mutation.forEach(e =>
        console.log(
          `    ${chalk.yellow("File")} ${e.file} ${chalk.yellow(
            "with mutation"
          )} ${e.mutation}`
        )
      );
    }

    // tell the user about issues with reading the data off the disk
    if (fileResults.errors.dataRead.length) {
      console.log(
        chalk.red(
          `  ${
            fileResults.errors.dataRead.length
          } had issues loading the data from disk`
        )
      );
      fileResults.errors.dataRead.forEach(e =>
        console.log(`    ${chalk.yellow("File")} ${e.file}`)
      );
    }

    // tell the user about issues uploading the data to the user
    if (uploadErrorKeys.length) {
      console.log(
        chalk.red(`  ${uploadErrorKeys.length} had issues uploading the data`)
      );
      uploadErrorKeys.forEach(file =>
        console.log(
          `    ${chalk.yellow("File")} ${file} ${chalk.yellow("in")} ${
            fileResults.errors.uploading[file]
          } ${chalk.yellow("batches")}`
        )
      );
    }

    // let the user know how to find more information about the issues
    console.log(
      chalk.red(
        "For more information on the errors please look through the full output of the command"
      )
    );
  } else {
    // let the user know that no issues happened during the command
    console.log(chalk.green("✔ Total success"));
  }
};

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

import {
  capitalize,
  ellipse,
  getAllFiles,
  getEndpoint,
  readFile,
  readJson
} from "./util";

const DEFAULT_BATCH_SIZE = 1000000;

const SupportedTypes = [".csv", ".json"]; // NOTE: all lowercase!

// Plugin boilerplate
export const command =
  "mload <fileOrDir> [--project] [--endpoint] [--mutation] [--batchsize|-b]";
export const desc = "Load a file or directory tree into Maana Q";
export const builder = {
  mutation: {
    alias: "m",
    description: "mutation to call (must take an array of instances)"
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

const getSchema = config => {
  const schemaPath = config.schemaPath;
  const schemaContents = fs.readFileSync(schemaPath).toString();
  return buildASTSchema(parse(schemaContents));
};

const readCsvFile = (context, filePath) => {
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

const readJsonFile = (context, filePath) => {
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

const getMutation = (schema, mutationName) => {
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
      mutationField.description
    )}.`
  );
  return mutationField;
};

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
      inputType.description
    )}`
  );
  return inputType;
};

const convert = (type, val, def = null) => {
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

const buildMutation = (mutationField, inputType, data) => {
  const inputTypeFields = inputType.getFields();
  const instances = data
    .map(row => {
      const fields = Object.keys(row)
        .map(fieldName => {
          const value = row[fieldName];

          const field = inputTypeFields[fieldName];
          if (!field) {
            const msg = `Undefined field: ${chalk.yellow(fieldName)}`;
            console.log(chalk.red(`✘ ${msg}`));
            throw msg;
          }
          // console.log("field", field);

          const isList = isListType(field.type);
          // console.log("isList", isList);

          const isNonNull = isNonNullType(field.type);
          // console.log("isNonNull", isNonNull);

          const targetType = getNamedType(field.type);
          // console.log("targetType", targetType);

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
            const values = value.map(v => convert(targetType, v));
            return `${fieldName}: [${values.join(",")}]`;
          } else if (isList) {
            const msg = `Expected collection for ${chalk.yellow(fieldName)}: ${
              field.type
            } => ${JSON.stringify(value)}`;
            console.log(chalk.red(`✘ ${msg}`));
            throw msg;
          }
          return `${fieldName}: ${convert(targetType, value)}\n`;
        })
        .join(",");
      return `{${fields}}`;
    })
    .join(",");
  const mutation = `mutation { ${mutationField.name}(input:[${instances}]) }`;
  // console.log("mutation", mutation);
  return mutation;
};

const load = async (context, filePath, mutationName) => {
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

  // Generate a mutation name from base name
  const genMutationName = baseName => `add${capitalize(baseName)}s`;

  // Infer the mutation
  const useMutationName = mutationName || genMutationName(parsedPath.name);
  // console.log("useMutationName", useMutationName);

  const mutationField = getMutation(context.schema, useMutationName);
  if (!mutationField) {
    fileResults.errors.mutation.push({
      file: filePath,
      mutation: useMutationName
    });
    return;
  }
  // console.log("mutationField", mutationField);

  const inputType = getInputType(context.schema, mutationField);
  if (!inputType) {
    fileResults.errors.mutation.push({
      file: filePath,
      mutation: useMutationName
    });
    return;
  }
  // console.log("inputType", inputType);
  // console.log("inputType fields", inputType.getFields());

  const readData = () => {
    switch (ext) {
      case ".csv":
        return readCsvFile(context, filePath);
      case ".json":
        return readJsonFile(context, filePath);
      default:
        return null; // should be unreachable
    }
  };

  const data = readData();
  if (!data) {
    fileResults.errors.dataRead.push({ file: filePath });
    return;
  }

  let offset = 0;
  const batchSize = context.argv.batchsize || DEFAULT_BATCH_SIZE;
  // console.log("batchSize", batchSize);

  while (offset < data.length) {
    let end = offset + batchSize;
    if (end > data.length) {
      end = data.length;
    }
    const batch = data.slice(offset, end);

    let mutation;
    try {
      mutation = buildMutation(mutationField, inputType, batch);
    } catch {
      fileResults.errors.mutation.push({
        file: filePath,
        mutation: useMutationName
      });
      return;
    }
    if (!mutation) {
      fileResults.errors.mutation.push({
        file: filePath,
        mutation: useMutationName
      });
      return;
    }

    try {
      if ((offset === 0 && data.length > end) || offset > 0) {
        context.spinner.start(
          chalk.yellow(`Uploading batch ${offset}-${end} of ${data.length}`)
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
      await load(context, filePaths[i], argv.mutation);
    }
  } else {
    await load(context, fileOrDir, argv.mutation);
  }

  // output the results from processing and uploading the files
  buildReport();
};

function buildReport() {
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
    console.log(chalk.green("✔ all json and csv files uploaded successfully"));
  }
}

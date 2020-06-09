# Command Line Interface (CLI) for Maana Q

The Maana Q CLI is a custom [graphql-cli](https://github.com/graphql-cli/graphql-cli) plugin to programmatically interact with a Maana Q instance. As a plug-in to the standard GraphQL CLI, the standard configuration and command syntax is followed (i.e., all examples assume you are running from a directory with a valid `.graphqlconfig` file. See below for how to add authentication).

# Installation

Assuming you already have a valid [NodeJS and npm](https://nodejs.org/en/) setup:

```
npm i -g graphql-cli@~3.0 graphql-cli-maana
```

**graphql-cli version:** Note that version 3 of graphql-cli is required. Problems around broken installs, or unidentified or missing commands may be indicative of a wrong version being used.

# Authentication

Maana service endpoints require a valid (authenticated) user in order to prevent unauthorized access.

After creating a new `.graphqlconfig` file connecting to a Maana API endpoint:

- Login to the Maana Knowledge Portal
- Click on your user icon and select your profile
- At the bottom of the profile page click the 'Get CLI Authentication Token' button
- Go through the login process (again)
- Copy the generated auth token that shows up below the button
- In the terminal run `gql msignin` and when asked paste the Authentication Token into the prompt
- Then run `gql menv --shell <your shell>` and follow the directions at the bottom of the output
- Run `gql ping` to test out that the authentication works (you will get an error if it did not)

## Notes

- When you add another project to your `.graphqlconfig` file you can run `gql maddheaders --project <Project Name>` to add the headers to the new project.
- When you want to run the CLI against the Maana API in a different terminal window you will need to run `gql env` again.
- If your authentication token expires you can run `gql mrefreshauth` to refresh the authentication token, when the Maana API is configured to allow the refreshing of authentication tokens.

# CLI Development

## To build and install the CLI

```sh
npm i
npm run build
npm i -g
```

## To publish

```sh
npm adduser --registry https://registry.npmjs.org
npm version 3.2.2-beta.42
npm publish --registry https://registry.npmjs.org --tag beta
```

# Commands

## mcreate

Create a new Q-ready microservice project using boilerplates in various languages and technologies.

## mdeploy

Build and deploy a Q-ready microservice to a Docker registry and Kubernetes cluster.

### Prerequisites

- [docker](https://docs.docker.com/v17.09/engine/installation/)
  - username & password to the Docker registry (from Sys Admin)
- [kubectl](https://kubernetes.io/docs/tasks/tools/install-kubectl/)
  - config file for the K8 cluster (from Sys Admin)
- [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/?view=azure-cli-latest)
- [graphql-cli](https://github.com/Urigo/graphql-cli)
- [graphql-cli-maana](https://github.com/maana-io/q-cli)

### Configure

Ensure Kubernetes is configured to use the cluster information provided by Sys Admin:

```bash
export KUBECONFIG=/home/<user>/<K8 conf file>.conf
```

Replace with correct path to your file.

### Login

```bash
docker login services.azurecr.io
```

Use the username and password shared from Ops.

### CLI mdeploy

```bash
gql mdeploy
```

Select the `Private Docker Registry` option and follow the prompts and accept defaults.

### Programmatic deployment

It is possible to do programmatic deployment of the service without interactive prompts:

```bash
gql mdeploy --pr --name myservice --path . --tag v5 --registry services.azurecr.io --replicas 1 --port 8050
```

## mload

Upload CSV and JSON files to various GraphQL-based storage targets, e.g., [neo4j-graphql](https://github.com/neo4j-graphql), [Prisma](https://github.com/prismagraphql/prisma) ([OpenCRUD](https://www.opencrud.org/)), or Maana's KindDB.

The only required argument is `fileOrDir`. Filename are then assumed to match their corresponding GraphQL type definition. For example, `type Person {}` would have data in a file `Person.json` or `Person.csv`. This is especially useful for uploading an entire set of data (many kinds) from an entire directory to a **persistent subgraph**.

Otherwise, if uploading a single or multiple files of the same kind but with different names from the corresponding GraphQL type, then the type may be explicitly specified (`-t`) and/or the mutation to use (`-m`).

### Normalized Document Format

The NDF is an [emerging standard](https://www.prisma.io/docs/reference/data-import-and-export/normalized-data-format-teroo5uxih) used by the [Prisma ORM-like layer](https://www.prisma.io/) to abstract various underlying storage systems, such as MySQL, Postgres, MongoDB, and a growing list of other connectors.

The `mload` command offers a conversion option to take CSV or JSON input data conforming to some GraphQL schema and convert it to the required _nodes_, _lists_, and _relations_ that the Prisma endpoint expects. The data is conformed to the matching schema type definitions using the same rules described above.

Note that IDs must be marked with `@unique` and are (currently) limited to `CHAR(25)`. If IDs are specified that are longer than this limit, then they will be automatically MD5 hashed into a compact Base64 representation.

### Arguments and Options

- `fileOrDir` (required) - specifies a supported file (.csv or .json) or a directory (recursively processed)
  - mutation names are automatically inferred from file names
  - file names should match the (singular) entity name (e.g., Person.json) => addPersons (= assumed mutation)
- `-m | --mutation` (optional) - explicit mutation to use (for a single file only)
- `-b | --batch` (optional) - limit on how many instances to send at time
- `-n | --ndfout` (optional) - Normalized Document Format conversion output
- `-t | --type` (optional) - explicit typename to use for NDF conversion
- `-p | --project` (optional) - project in .graphqlconfig
- `-e | --endpoint` (optional) - optional endpoing in .graphqlconfig

### Examples

```sh
# load all the CSV and JSON files in the data folder using the .graphqlconfig project 'test
gql mload -p test data/

# load a specific file
gql mload -p test data/Person.json

# load a specific file in batches with an explicit mutation
gql mload -p test data/Person.json -m addEmployees -b 1000

# convert a folder of data to NDF format
gql mload -p test data/ -n ndf/
```

## maddsvc

Add or update a service from source (model file) or manifest (service description).

Note: Either -s (source) or -m (manifest) is required.

### Arguments and Options

- `name` (required) - name for the service
- `-i | --id` (optional) - explicit ID of the service (will overwrite, if it already exists)
- `-d | --desc` (optional) - description of the service
- `-s | --source` (ootional) - a GraphQL SDL file defining a set of types that Maana will create a fully-managed service for
- `-m | --manifest` (optional) - a JSON description of a service manifest instance (see below)

### Examples

```sh
# create a service from a model with an explicit ID
gql maddsvc MyService -s model.gql -i io.acme.myservice
```

## msignin

Sign into the Maana CLI so you can authenticate against the Maana API.

Authenticated CLI sessions (access token lifespans) do not automatically refresh--they must be refreshed manually with 'mrefreshauth' and exported again with 'menv'.

Note: Auth provider must be configured to issue CLI access tokens with a sufficiently long lifespan to perform long running tasks. Default recommendation is 10 hours.

Compatible with Maana Q v3.1.0+.

### Arguments and Options

- `Authentication Token` (optional) - the authentication token retrieved from the web UI. You will be asked for this later if it is not provided.
- `-p | --project` (optional) - when provided you will only sign in for a specific project instead of all projects in the config file

### Examples

```sh
# sign into the Maana CLI
gql msignin
```

## maddheaders

Adds authentication headers for authenticating against the Maana API.

Compatible with Maana Q v3.1.0+.

### Arguments and Options

- `-p | --project` (optional) - only adds the headers to a specific project when provided, otherwise adds them to all the projects in the config file

### Examples

```sh
# add headers to a project
gql maddheaders -p ckg
```

## menv

Used to export the authentication environment variables into your terminal so that the CLI commands can use them.

Compatible with Maana Q v3.1.0+.

### Arguments and Options

- `-s | --shell` (optional) - defines the shell that you are using (bash, fish, zsh, cmd, powershell). If this is not provided, the `SHELL` environment variable is used.
- `-p | --project` (optional) - when provided will look for project specific authentication information instead of looking at the root config file level

### Examples

```sh
# Bash
gql menv --shell bash
```

```bat
rem Windows command line
gql menv --shell cmd
```

```ps1
# Windows power shell
gql menv --shell powershell
```

## mrefreshauth

Used to get an new authentication token when it has expired. The Maana API must be configured to support this.

Note: Auth provider must be configured for refresh token lifespan capable of refreshing access tokens after they expire; i.e. longer than the access token lifespan.

Compatible with Maana Q v3.1.0+.

### Arguments and Options

- `-p | --project` (optional) - when provided this will refresh project specific authentication information instead of doing it at the root config level

### Examples

```sh
# refreshing an authentication token
gql mrefreshauth
```

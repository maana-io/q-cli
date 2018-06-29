# Maana Plugin for the GraphQL Command Line

Custom [graphql-cli](https://github.com/graphql-cli/graphql-cli) plugin to programmatically interact with a Maana cluster.

> All examples assume you are running from a directory with a valid `.graphqlconfig` file. See below for how to add authentication.

## Commands

### mload

Upload CSV and JSON files to a Maana cloud instance, with possible NDF conversion.

Note: JSON files must be a collection (array) of instances.

#### Normalized Document Format

The NDF is an [emerging standard](https://www.prisma.io/docs/reference/data-import-and-export/normalized-data-format-teroo5uxih) used by the [Prisma ORM-like layer](https://www.prisma.io/).

#### Arguments and Options

- `fileOrDir` (required) - specifies a supported file (.csv or .json) or a directory (recursively processed)
  - mutation names are automatically inferred from file names
  - file names should match the (singular) entity name (e.g., person.json) => addPersons (= assumed mutation)
- `-m | --mutation` (optional) - explicit mutation to use (for a single file only)
- `-b | --batch` (optional) - limit on how many instances to send at time
- `-n | --ndfout` (optional) - Normalized Document Format conversion output
- `-t | --type` (optional) - explicit typename to use for NDF conversion
- `-p | --project` (optional) - project in .graphqlconfig
- `-e | --endpoint` (optional) - optional endpoing in .graphqlconfig

#### Examples

```sh
# load all the CSV and JSON files in the data folder using the .graphqlconfig project 'test
gql mload -p test data/

# load a specific file
gql mload -p test data/person.json

# load a specific file in batches with an explicit mutation
gql mload -p test data/person.json -m addEmployees -b 1000

# convert a folder of data to NDF format
gql mload -p test data/ -n ndf/
```

### maddsvc

Add or update a service from source (model file) or manifest (service description).

Note: Either -s (source) or -m (manifest) is required.

#### Arguments and Options

- `name` (required) - name for the service
- `-i | --id` (optional) - explicit ID of the service (will overwrite, if it already exists)
- `-d | --desc` (optional) - description of the service
- `-s | --source` (ootional) - a GraphQL SDL file defining a set of types that Maana will create a fully-managed service for
- `-m | --manifest` (optional) - a JSON description of a service manifest instance (see below)

#### Examples

```sh
# create a service from a model with an explicit ID
gql maddsvc MyService -s model.gql -i io.acme.myservice
```

### msignin

Sign into the Maana CLI so you can authenticate against the Maana API.

Compatible with Maana Q v3.1.0+.

#### Arguments and Options

- `Authentication Token` (optional) - the authentication token retrieved from the web UI. You will be asked for this later if it is not provided.
- `-p | --project` (optional) - when provided you will only sign in for a specific project instead of all projects in the config file

#### Examples

```sh
# sign into the Maana CLI
gql msignin
```

### maddheaers

Adds authentication headers for authenticating against the Maana API.

Compatible with Maana Q v3.1.0+.

#### Arguments and Options

- `-p | --project` (optional) - only adds the headers to a specific project when provided, otherwise adds them to all the projects in the config file

#### Examples

```sh
# add headers to a project
gql maddheaders -p ckg
```

### menv

Used to export the authentication environment variables into your terminal so that the CLI commands can use them.

Compatible with Maana Q v3.1.0+.

#### Arguments and Options

- `-s | --shell` (optional) - defines the shell that you are using (bash, fish, zsh, cmd, powershell). If this is not provided, the `SHELL` environment variable is used.
- `-p | --project` (optional) - when provided will look for project specific authentication information instead of looking at the root config file level

#### Examples

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

### mrefreshauth

Used to get an new authentication token when it has expired. The Maana API must be configured to support this.

Compatible with Maana Q v3.1.0+.

#### Arguments and Options

- `-p | --project` (optional) - when provided this will refresh project specific authentication information instead of doing it at the root config level

#### Examples

```sh
# refreshing an authentication token
gql mrefreshauth
```

## Add authentication to requests

Maana endpoints require a valid (authenticated) user in order to prevent unauthorized access.

### Maana Q v3.1.0 and later

After creating a new `.graphqlconfig` file connecting to a Maana API endpoint:

- Login to the Maana Knowledge Portal
- Click on your user icon and select your profile
- At the bottom of the profile page click the 'Get CLI Authentication Token' button
- Go through the login process (again)
- Copy the generated auth token that shows up below the button
- In the terminal run `gql msignin` and when asked paste the Authentication Token into the prompt
- Then run `gql menv --shell <your shell>` and follow the directions at the bottom of the output
- Run `gql ping` to test out that the authentication works (you will get an error if it did not)

#### Additional Notes

- When you add another project to your `.graphqlconfig` file you can run `gql maddheaders --project <Project Name>` to add the headers to the new project.
- When you want to run the CLI against the Maana API in a different terminal window you will need to run `gql env` again.
- If your authentication token expires you can run `gql mrefreshauth` to refresh the authentication token, when the Maana API is configured to allow the refreshing of authentication tokens.

### Maana Q v3.0.5

After creating a new project connecting to a Maana endpoint, you will need to setup the project to add an authentication header to the requests.

- Login to the Maana Knowledge Portal
- Click on your user icon and select your profile
- At the bottom of the profile page click the 'Get CLI Authentication Token' button
- Go through the login process (again)
- Copy the generated auth token that shows up below the button
- In the terminal add an environment variable for the auth token

```sh
# *nix based systems
export AUTH_TOKEN_ENV=<paste auth token here>
```

```bat
rem Windows command line
set AUTH_TOKEN_ENV=<paste auth token here>
```

```ps1
# Windows power shell
$Env:AUTH_TOKEN_ENV = "<paste auth token here>"
```

Add the authorization header to the Maana endpoint:

```diff
     "ckg": {
      "schemaPath": "ckg.graphql",
       "extensions": {
         "endpoints": {
-           "default": "https://qtraining01.knowledge.maana.io:8443/graphql"
+           "default": {
+             "url": "https://qtraining01.knowledge.maana.io:8443/graphql",
+             "headers": {
+               "Authorization": "Bearer ${env:AUTH_TOKEN_ENV}"
+             }
+           }
         }
       }
     }
```

## To build and install

```sh
npm i
npm run build
npm i -g
```

## To publish

```sh
npm adduser --registry https://registry.npmjs.org
npm publish --registry https://registry.npmjs.org
```

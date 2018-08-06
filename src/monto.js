import n3 from 'n3'
import fs from 'fs-extra'
import path from 'path'
import mkdirp from 'mkdirp'
import chalk from 'chalk'
import url from 'url'

import { append, getOrSet, stripCRLF, readJson } from './util'

// Plugin boilerplate
export const command = 'monto <inputPath>'
export const desc =
  "Interpret an ontology, in the form of assertions (subject, predicate, object), into Maana Q's CKG (GraphQL types + Links & Relations)."
export const builder = {
  inputPath: {
    description:
      'Path to the input file.  Supported types:  Turtle, TriG, N-Triples, N-Quads, and Notation3 (N3)'
  },
  outputDir: {
    alias: 'o',
    description: 'Output directory (default = ./<inputPath dir>)'
  },
  map: {
    alias: 'm',
    description: 'Custom ontology map'
  }
}

// Default ontology map
const defOntoMap = {
  //
  // Assumed types
  //
  givenTypes: {
    'http://www.w3.org/2000/01/rdf-schema#Class': {},
    'http://www.w3.org/2002/07/owl#Thing': {},
    'http://www.w3.org/2000/01/rdf-schema#Resource': {}
  },

  //
  // Predicates
  //

  // "hasType" relation
  typeP: { 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type': {} },

  // "hasDomain" relation
  domainP: {
    'http://schema.org/domainIncludes': {},
    'http://www.w3.org/2000/01/rdf-schema#domain': {}
  },

  // "hasRange" relation
  rangeP: {
    'http://schema.org/rangeIncludes': {},
    'http://www.w3.org/2000/01/rdf-schema#range': {}
  },

  // "subClassOf" relation
  subclassP: { 'http://www.w3.org/2000/01/rdf-schema#subClassOf': {} },

  // "comment" relation
  commentP: { 'http://www.w3.org/2000/01/rdf-schema#comment': {} },

  // skip
  ignoreP: { 'http://www.w3.org/2000/01/rdf-schema#label': {} },

  //
  // Objects
  //

  // "typeOf" Property
  propertyTypes: { 'http://www.w3.org/1999/02/22-rdf-syntax-ns#Property': {} },

  // "typeOf" Class
  classTypes: {
    'http://www.w3.org/2000/01/rdf-schema#Class': {},
    'http://www.w3.org/2002/07/owl#Class': {}
  }
}

// Helper to track of self-identifying objects
const indexedItem = (index, k) => getOrSet(index, k, { id: k })

// Helper to extract a name from a URI
const nameFromUri = uri => {
  if (!uri) return '#UNDEFINED#'
  const parsedUri = url.parse(uri)
  return parsedUri.hash
    ? parsedUri.hash.slice(1)
    : parsedUri.path.split('/').slice(-1)[0]
}

export const handler = async (context, argv) => {
  // Grab local copies of arguments
  const inputPathname = argv.inputPath
  // console.log('inputFilename', inputFilename)

  // Parse the path into its components
  const inputPath = path.parse(inputPathname)
  // console.log("inputPath", inputPath);

  // Generate output path and filenames based on input filename, if not provided
  let outputDir = argv.outputDir
  if (!outputDir) {
    outputDir = path.join(inputPath.root, inputPath.dir, inputPath.name)
  }
  console.log('outputDir', outputDir)
  mkdirp(outputDir, err => {
    if (err) {
      console.log(
        chalk.red(`Can't create output directory:${chalk.yellow(err)}`)
      )
    }
  })

  // Load or use default ontology map
  let ontoMap = defOntoMap
  const ontoMapFilename = argv.map
  if (ontoMapFilename) {
    ontoMap = Object.assign(defOntoMap, readJson(ontoMapFilename))
  }
  // console.log("ontoMap", ontoMap);

  // Update UI
  context.spinner.start(`Parsing ${chalk.yellow(inputPathname)}\n`)

  // Create a parser and input stream
  const parser = n3.Parser()
  const readStream = fs.createReadStream(inputPathname)

  // State
  const types = {}
  const properties = {}
  const comments = {}
  const subclasses = {}
  const superclasses = {}
  const unions = {}
  const relations = {}

  // Helper to ensure a property is valid
  const isValidProp = p => {
    const prop = properties[p]
    if (!prop) {
      console.log(chalk.red(`Property not defined: ${chalk.yellow(p)}`))
      return false
    }
    if (!prop.domains || prop.domains.length === 0) {
      console.log(
        chalk.red(`Property missing domain(s): ${chalk.yellow(prop.id)}`)
      )
      return false
    }
    if (!prop.ranges || prop.ranges.length === 0) {
      console.log(
        chalk.red(`Property missing range(s): ${chalk.yellow(prop.id)}`)
      )
      return false
    }
    return true
  }

  // Recursively walk a superclass hierarchy to form an entire collection
  const allSuperclasses = root => {
    const set = new Set()

    const visit = cur => {
      const supers = superclasses[cur]
      if (!supers) return
      supers.filter(x => !set.has(x)).forEach(x => {
        set.add(x)
        visit(x)
      })
    }

    visit(root)
    return [...set]
  }

  // Assumed types
  for (let t in ontoMap.givenTypes) indexedItem(types, t)

  // Parse the input file
  let assertionCnt = 0
  parser.parse(readStream, (error, quad, prefixes) => {
    //
    // Parse errors
    //
    if (error) {
      context.spinner.fail(
        chalk.red(`Parse failed: ${chalk.yellow(JSON.stringify(error))}`)
      )
      return
    }

    //
    // Process a quad
    //
    if (quad) {
      assertionCnt++

      const { subject, predicate, object } = quad

      // Drive from the predicate
      if (predicate.termType === 'NamedNode') {
        if (ontoMap.typeP[predicate.value]) {
          //
          // subject hasType object
          //

          // is object a class or a property?
          if (ontoMap.classTypes[object.value]) {
            indexedItem(types, subject.value)
          } else if (ontoMap.propertyTypes[object.value]) {
            indexedItem(properties, subject.value)
          }
        } else if (ontoMap.domainP[predicate.value]) {
          //
          // property applies to class
          //
          const prop = indexedItem(properties, subject.value)
          append(prop, 'domains', object.value)
        } else if (ontoMap.rangeP[predicate.value]) {
          //
          // property takes values of type
          //
          const prop = indexedItem(properties, subject.value)
          append(prop, 'ranges', object.value)
        } else if (ontoMap.subclassP[predicate.value]) {
          //
          // subject subClassof object
          //
          const subclass = subject.value
          const superclass = object.value
          // update the set of superclasses for this subclass
          append(superclasses, subclass, superclass)
          // update the set of subclasses for this superclass
          append(subclasses, superclass, subclass)
        } else if (ontoMap.commentP[predicate.value]) {
          //
          // Add comment
          //
          append(comments, subject.value, stripCRLF(object.value))
        } else if (ontoMap.ignoreP[predicate.value]) {
          //
          // ignore this assertion
          //
        } else {
          //
          // otherwise, record an arbitrary relation
          //
          const rel = indexedItem(relations, predicate.value)
          append(rel, 'links', { subject, object })
        }
      } else {
        console.log(
          chalk.red(
            `Unknown predicate term type: ${chalk.yellow(predicate.termType)}`
          )
        )
      }
      return
    } // process quad

    //
    // End of parsing
    //
    context.spinner.succeed(
      chalk.green(`Parsed ${chalk.yellow(assertionCnt)} assertions`)
    )

    if (types.length === 0) {
      console.log(chalk.red(`No types were found.`))
      return
    }

    let outputPathname = `${outputDir}/model.gql`
    context.spinner.start(`Generating ${chalk.yellow(outputPathname)}\n`)

    // Assign each of the properties to their respective types (domains)
    Object.keys(properties)
      .filter(isValidProp)
      .forEach(p => {
        const prop = properties[p]

        // Derive the name of the property from its URI
        const propName = nameFromUri(p)

        // For each domain this is a property of...
        prop.domains.forEach(t => {
          const type = types[t]
          if (!type) {
            console.log(chalk.red(`Missing domain type: ${t}`))
            return
          }
          // Infer the type (from the range or ranges)
          let propType
          if (prop.ranges.length > 1) {
            // Construct a union
            propType = propName.charAt(0).toUpperCase() + propName.slice(1)
            const union = prop.ranges.map(nameFromUri)
            unions[propType] = union
          } else {
            // Simple range
            propType = nameFromUri(prop.ranges[0])
          }

          // Any comments?
          const propComments = comments[p]

          // Associate with type
          type[p] = {
            name: propName,
            type: propType,
            comments: propComments
          }
        })
      })

    // Create an output stream
    const writeStream = fs.createWriteStream(outputPathname)

    // For all the types...
    Object.keys(types).forEach(t => {
      let type = types[t]
      const typeName = nameFromUri(type.id)

      // Emit any type-level comments
      const typeComments = comments[type.id]
      if (typeComments && typeComments.length > 0) {
        typeComments.forEach(c => {
          writeStream.write(`# ${c}\n`)
        })
      }

      // Introduce the type
      writeStream.write(`type ${typeName} {\n`)

      // Inline helper to emit properties for a type
      const emitProperties = theType => {
        // Emit the original subject URI as a comment
        writeStream.write(`\n  #\n  # ${theType.id} properties\n  #\n`)

        const props = Object.keys(theType).filter(p => p != 'id')

        if (props.length === 0) {
          writeStream.write(`  # (none)\n`)
        } else {
          props.forEach(p => {
            const prop = theType[p]

            // Emit any property-level comments
            if (prop.comments && prop.comments.length > 0) {
              prop.comments.forEach(c => {
                writeStream.write(`  # ${c}\n`)
              })
            }

            // Emit the property
            writeStream.write(`  ${prop.name}: ${prop.type}\n`)
          })
        }
      }

      // Current type
      emitProperties(type)

      // Merge the properties from the superclass hierarchy, if any
      const supers = allSuperclasses(t)
      if (supers && supers.length > 0) {
        supers.forEach(s => {
          const supertype = types[s]
          if (!supertype) {
            console.log(chalk.red(`Unknown superclass: ${chalk.yellow(s)}`))
            return
          }
          emitProperties(supertype)
        })
      }

      // Close the body of the type definition
      writeStream.write(`}\n\n`)
    })

    // Emit the unions
    for (let u in unions) {
      const union = unions[u]
      writeStream.write(`union ${u} = ${union.join(' | ')}\n`)
    }

    // close the stream
    writeStream.end()

    // Generate the relations
    const relOut = Object.keys(relations).map(r => {
      return { id: r, name: nameFromUri(r) }
    })
    outputPathname = `${outputDir}/relation.json`
    fs.writeFile(outputPathname, JSON.stringify(relOut, null, 2))

    // Generate the links
    const linkOut = []
    for (let r in relations) {
      const rel = relations[r]
      for (let l of rel.links) {
        linkOut.push({
          rel: r,
          from: l.subject.value,
          to: l.object.value
        })
      }
    }
    outputPathname = `${outputDir}/link.json`
    fs.writeFile(outputPathname, JSON.stringify(linkOut, null, 2))

    //
    // All done
    //
    context.spinner.succeed(
      chalk.green(
        `Generated ${chalk.yellow(
          Object.keys(types).length
        )} types, ${chalk.yellow(
          Object.keys(unions).length
        )} unions, ${chalk.yellow(relOut.length)} relations, and ${chalk.yellow(
          linkOut.length
        )} links`
      )
    )
  })
}

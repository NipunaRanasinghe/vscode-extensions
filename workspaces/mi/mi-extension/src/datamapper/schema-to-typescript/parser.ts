/**
 * This file includes code originally from:
 *   json-schema-to-typescript (https://github.com/bcherny/json-schema-to-typescript)
 *   Copyright (c) Boris Cherny
 *   Licensed under the MIT License: https://opensource.org/licenses/MIT
 *
 * Modifications and additional code copyright (c) 2025, WSO2 LLC. (https://www.wso2.com)
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import {JSONSchema4Type, JSONSchema4TypeName} from 'json-schema'
import {findKey, includes, isPlainObject, map, memoize, omit} from 'lodash'
import {format} from 'util'
import {Options} from './'
import {typesOfSchema} from './typesOfSchema'
import {
  AST,
  T_ANY,
  T_ANY_ADDITIONAL_PROPERTIES,
  TInterface,
  TInterfaceParam,
  TNamedInterface,
  TTuple,
  T_UNKNOWN,
  T_UNKNOWN_ADDITIONAL_PROPERTIES,
  TIntersection,
} from './types/AST'
import {
  getRootSchema,
  isBoolean,
  isPrimitive,
  JSONSchema as LinkedJSONSchema,
  JSONSchemaWithDefinitions,
  SchemaSchema,
  SchemaType,
} from './types/JSONSchema'
import {generateName, maybeStripDefault, maybeStripNameHints} from './utils'

export type Processed = Map<LinkedJSONSchema, Map<SchemaType, AST>>

export type UsedNames = Set<string>

export function parse(
  schema: LinkedJSONSchema | JSONSchema4Type,
  options: Options,
  keyName?: string,
  processed: Processed = new Map(),
  usedNames = new Set<string>(),
): AST {
  if (isPrimitive(schema)) {
    if (isBoolean(schema)) {
      return parseBooleanSchema(schema, keyName, options)
    }

    return parseLiteral(schema, keyName)
  }

  const types = typesOfSchema(schema)
  if (types.length === 1) {
    const ast = parseAsTypeWithCache(schema, types[0], options, keyName, processed, usedNames)
    return ast
  }

  // Be careful to first process the intersection before processing its params,
  // so that it gets first pick for standalone name.
  const ast = parseAsTypeWithCache(
    {
      $id: schema.$id,
      allOf: [],
      title: schema.title,
    },
    'ALL_OF',
    options,
    keyName,
    processed,
    usedNames,
  ) as TIntersection

  ast.params = types.map(type =>
    // We hoist description (for comment) and id/title (for standaloneName)
    // to the parent intersection type, so we remove it from the children.
    parseAsTypeWithCache(maybeStripNameHints(schema), type, options, keyName, processed, usedNames),
  )

  return ast
}

function parseAsTypeWithCache(
  schema: LinkedJSONSchema,
  type: SchemaType,
  options: Options,
  keyName?: string,
  processed: Processed = new Map(),
  usedNames = new Set<string>(),
): AST {
  // If we've seen this node before, return it.
  let cachedTypeMap = processed.get(schema)
  if (!cachedTypeMap) {
    cachedTypeMap = new Map()
    processed.set(schema, cachedTypeMap)
  }
  const cachedAST = cachedTypeMap.get(type)
  if (cachedAST) {
    return cachedAST
  }

  // Cache processed ASTs before they are actually computed, then update
  // them in place using set(). This is to avoid cycles.
  // TODO: Investigate alternative approaches (lazy-computing nodes, etc.)
  const ast = {} as AST
  cachedTypeMap.set(type, ast)

  // Update the AST in place. This updates the `processed` cache, as well
  // as any nodes that directly reference the node.
  return Object.assign(ast, parseNonLiteral(schema, type, options, keyName, processed, usedNames))
}

function parseBooleanSchema(schema: boolean, keyName: string | undefined, options: Options): AST {
  if (schema) {
    return {
      keyName,
      type: options.unknownAny ? 'UNKNOWN' : 'ANY',
    }
  }

  return {
    keyName,
    type: 'NEVER',
  }
}

function parseLiteral(schema: JSONSchema4Type, keyName: string | undefined): AST {
  return {
    keyName,
    params: schema,
    type: 'LITERAL',
  }
}

function parseNonLiteral(
  schema: LinkedJSONSchema,
  type: SchemaType,
  options: Options,
  keyName: string | undefined,
  processed: Processed,
  usedNames: UsedNames,
): AST {
  const definitions = getDefinitionsMemoized(getRootSchema(schema as any)) // TODO
  const keyNameFromDefinition = findKey(definitions, _ => _ === schema)

  switch (type) {
    case 'ALL_OF':
      return {
        deprecated: schema.deprecated,
        keyName,
        standaloneName: standaloneName(schema, keyNameFromDefinition, usedNames, options),
        params: schema.allOf!.map(_ => parse(_, options, undefined, processed, usedNames)),
        type: 'INTERSECTION',
      }
    case 'ANY':
      return {
        ...(options.unknownAny ? T_UNKNOWN : T_ANY),
        deprecated: schema.deprecated,
        keyName,
        standaloneName: standaloneName(schema, keyNameFromDefinition, usedNames, options),
      }
    case 'ANY_OF':
      return {
        deprecated: schema.deprecated,
        keyName,
        standaloneName: standaloneName(schema, keyNameFromDefinition, usedNames, options),
        params: schema.anyOf!.map(_ => parse(_, options, undefined, processed, usedNames)),
        type: 'UNION',
      }
    case 'BOOLEAN':
      return {
        deprecated: schema.deprecated,
        keyName,
        standaloneName: standaloneName(schema, keyNameFromDefinition, usedNames, options),
        type: 'BOOLEAN',
      }
    case 'CUSTOM_TYPE':
      return {
        deprecated: schema.deprecated,
        keyName,
        params: schema.tsType!,
        standaloneName: standaloneName(schema, keyNameFromDefinition, usedNames, options),
        type: 'CUSTOM_TYPE',
      }
    case 'NAMED_ENUM':
      return {
        deprecated: schema.deprecated,
        keyName,
        standaloneName: standaloneName(schema, keyNameFromDefinition ?? keyName, usedNames, options)!,
        params: schema.enum!.map((_, n) => ({
          ast: parseLiteral(_, undefined),
          keyName: schema.tsEnumNames![n],
        })),
        type: 'ENUM',
      }
    case 'NAMED_SCHEMA':
      return newInterface(schema as SchemaSchema, options, processed, usedNames, keyName, keyNameFromDefinition)
    case 'NEVER':
      return {
        deprecated: schema.deprecated,
        keyName,
        standaloneName: standaloneName(schema, keyNameFromDefinition, usedNames, options),
        type: 'NEVER',
      }
    case 'NULL':
      return {
        deprecated: schema.deprecated,
        keyName,
        standaloneName: standaloneName(schema, keyNameFromDefinition, usedNames, options),
        type: 'NULL',
      }
    case 'NUMBER':
      return {
        deprecated: schema.deprecated,
        keyName,
        standaloneName: standaloneName(schema, keyNameFromDefinition, usedNames, options),
        type: 'NUMBER',
      }
    case 'OBJECT':
      return {
        keyName,
        standaloneName: standaloneName(schema, keyNameFromDefinition, usedNames, options),
        type: 'OBJECT',
        deprecated: schema.deprecated,
      }
    case 'ONE_OF':
      return {
        deprecated: schema.deprecated,
        keyName,
        standaloneName: standaloneName(schema, keyNameFromDefinition, usedNames, options),
        params: schema.oneOf!.map(_ => parse(_, options, undefined, processed, usedNames)),
        type: 'UNION',
      }
    case 'REFERENCE':
      throw Error(format('Refs should have been resolved by the resolver!', schema))
    case 'STRING':
      return {
        deprecated: schema.deprecated,
        keyName,
        standaloneName: standaloneName(schema, keyNameFromDefinition, usedNames, options),
        type: 'STRING',
      }
    case 'TYPED_ARRAY':
      if (Array.isArray(schema.items)) {
        if (schema.items.length > 0) {
          schema.items = schema.items[0];
          return {
            deprecated: schema.deprecated,
            keyName,
            standaloneName: standaloneName(schema, keyNameFromDefinition, usedNames, options),
            params: parse(schema.items!, options, `{keyNameFromDefinition}Items`, processed, usedNames),
            type: 'ARRAY',
          };
        }
      } else {
        return {
          deprecated: schema.deprecated,
          keyName,
          standaloneName: standaloneName(schema, keyNameFromDefinition, usedNames, options),
          params: parse(schema.items!, options, `{keyNameFromDefinition}Items`, processed, usedNames),
          type: 'ARRAY',
        }
      }
    case 'UNION':
      return {
        deprecated: schema.deprecated,
        keyName,
        standaloneName: standaloneName(schema, keyNameFromDefinition, usedNames, options),
        params: (schema.type as JSONSchema4TypeName[]).map(type => {
          const member: LinkedJSONSchema = {...omit(schema, '$id', 'description', 'title'), type}
          return parse(maybeStripDefault(member as any), options, undefined, processed, usedNames)
        }),
        type: 'UNION',
      }
    case 'UNNAMED_ENUM':
      return {
        deprecated: schema.deprecated,
        keyName,
        standaloneName: standaloneName(schema, keyNameFromDefinition, usedNames, options),
        params: schema.enum!.map(_ => parseLiteral(_, undefined)),
        type: 'UNION',
      }
    case 'UNNAMED_SCHEMA':
      return newInterface(schema as SchemaSchema, options, processed, usedNames, keyName, keyNameFromDefinition)
    case 'UNTYPED_ARRAY':
      // normalised to not be undefined
      const minItems = schema.minItems!
      const maxItems = typeof schema.maxItems === 'number' ? schema.maxItems : -1
      const params = options.unknownAny ? T_UNKNOWN : T_ANY
      if (minItems > 0 || maxItems >= 0) {
        return {
          deprecated: schema.deprecated,
          keyName,
          maxItems: schema.maxItems,
          minItems,
          // create a tuple of length N
          params: Array(Math.max(maxItems, minItems) || 0).fill(params),
          // if there is no maximum, then add a spread item to collect the rest
          spreadParam: maxItems >= 0 ? undefined : params,
          standaloneName: standaloneName(schema, keyNameFromDefinition, usedNames, options),
          type: 'TUPLE',
        }
      }

      return {
        deprecated: schema.deprecated,
        keyName,
        params,
        standaloneName: standaloneName(schema, keyNameFromDefinition, usedNames, options),
        type: 'ARRAY',
      }
  }
}

/**
 * Compute a schema name using a series of fallbacks
 */
function standaloneName(
  schema: LinkedJSONSchema,
  keyNameFromDefinition: string | undefined,
  usedNames: UsedNames,
  options: Options,
): string | undefined {
  const name =
    options.customName?.(schema, keyNameFromDefinition) || schema.title || keyNameFromDefinition
  if (name) {
    return generateName(name, usedNames)
  }
}

function newInterface(
  schema: SchemaSchema,
  options: Options,
  processed: Processed,
  usedNames: UsedNames,
  keyName?: string,
  keyNameFromDefinition?: string,
): TInterface {
  const name = standaloneName(schema, keyNameFromDefinition, usedNames, options)!
  return {
    deprecated: schema.deprecated,
    keyName,
    params: parseSchema(schema, options, processed, usedNames, name),
    standaloneName: name,
    superTypes: parseSuperTypes(schema, options, processed, usedNames),
    type: 'INTERFACE',
  }
}

function parseSuperTypes(
  schema: SchemaSchema,
  options: Options,
  processed: Processed,
  usedNames: UsedNames,
): TNamedInterface[] {
  // Type assertion needed because of dereferencing step
  // TODO: Type it upstream
  const superTypes = schema.extends as SchemaSchema[] | undefined
  if (!superTypes) {
    return []
  }
  return superTypes.map(_ => parse(_, options, undefined, processed, usedNames) as TNamedInterface)
}

/**
 * Helper to parse schema properties into params on the parent schema's type
 */
function parseSchema(
  schema: SchemaSchema,
  options: Options,
  processed: Processed,
  usedNames: UsedNames,
  parentSchemaName: string,
): TInterfaceParam[] {
  if (schema.attributes) {
    for (const key in schema.attributes) {
      if (schema.properties) {
        schema.properties["attr_" + key] = schema.attributes[key];
      } else {
        schema.properties = {["attr_" + key]: schema.attributes[key]};
      }
    }
  }
  let asts: TInterfaceParam[] = map(schema.properties, (value, key: string) => ({
    ast: parse(value, options, key, processed, usedNames),
    isPatternProperty: false,
    isRequired: true,
    isUnreachableDefinition: false,
    keyName: key,
  }));

  let singlePatternProperty = false
  if (schema.patternProperties) {
    // partially support patternProperties. in the case that
    // additionalProperties is not set, and there is only a single
    // value definition, we can validate against that.
    singlePatternProperty = !schema.additionalProperties && Object.keys(schema.patternProperties).length === 1

    asts = asts.concat(
      map(schema.patternProperties, (value, key: string) => {
        const ast = parse(value, options, key, processed, usedNames)
//         const comment = `This interface was referenced by \`${parentSchemaName}\`'s JSON-Schema definition
// via the \`patternProperty\` "${key.replace('*/', '*\\/')}".`
        // ast.comment = ast.comment ? `${ast.comment}\n\n${comment}` : comment
        return {
          ast,
          isPatternProperty: !singlePatternProperty,
          isRequired: true,
          isUnreachableDefinition: false,
          keyName: singlePatternProperty ? '[k: string]' : key,
        }
      }),
    )
  }

  if (options.unreachableDefinitions) {
    asts = asts.concat(
      map(schema.$defs, (value, key: string) => {
        const ast = parse(value, options, key, processed, usedNames)
//         const comment = `This interface was referenced by \`${parentSchemaName}\`'s JSON-Schema
// via the \`definition\` "${key}".`
//         ast.comment = ast.comment ? `${ast.comment}\n\n${comment}` : comment
        return {
          ast,
          isPatternProperty: false,
          isRequired: true,
          isUnreachableDefinition: true,
          keyName: key,
        }
      }),
    )
  }

  return asts
}

type Definitions = {[k: string]: LinkedJSONSchema}

function getDefinitions(
  schema: LinkedJSONSchema,
  isSchema = true,
  processed = new Set<LinkedJSONSchema>(),
): Definitions {
  if (processed.has(schema)) {
    return {}
  }
  processed.add(schema)
  if (Array.isArray(schema)) {
    return schema.reduce(
      (prev, cur) => ({
        ...prev,
        ...getDefinitions(cur, false, processed),
      }),
      {},
    )
  }
  if (isPlainObject(schema)) {
    return {
      ...(isSchema && hasDefinitions(schema) ? schema.$defs : {}),
      ...Object.keys(schema).reduce<Definitions>(
        (prev, cur) => ({
          ...prev,
          ...getDefinitions(schema[cur], false, processed),
        }),
        {},
      ),
    }
  }
  return {}
}

const getDefinitionsMemoized = memoize(getDefinitions)

/**
 * TODO: Reduce rate of false positives
 */
function hasDefinitions(schema: LinkedJSONSchema): schema is JSONSchemaWithDefinitions {
  return '$defs' in schema
}

'use strict';

// Minimal, dependency-free JSON Schema subset validator: type, required,
// properties, items, enum. This is deliberately not a full JSON Schema
// implementation — see scripts/product-docs/schemas/README.md for the exact
// limitation. Sufficient for shape-checking this tool's own generated output
// without adding an external dependency (ajv, etc.) per the Part 4 brief's
// "focused standard-library validator" instruction.
function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function validate(schema, data, pathStr = '$') {
  const errors = [];

  if (schema.type) {
    const actual = typeOf(data);
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!expected.includes(actual)) {
      errors.push(`${pathStr}: expected type ${expected.join('|')}, got ${actual}`);
      return errors; // type mismatch makes further checks meaningless
    }
  }

  if (schema.enum && !schema.enum.includes(data)) {
    errors.push(`${pathStr}: value "${data}" not in enum [${schema.enum.join(', ')}]`);
  }

  if (schema.type === 'object' || (typeOf(data) === 'object' && schema.properties)) {
    for (const key of schema.required || []) {
      if (!(key in data)) errors.push(`${pathStr}: missing required property "${key}"`);
    }
    for (const [key, subSchema] of Object.entries(schema.properties || {})) {
      if (key in data) errors.push(...validate(subSchema, data[key], `${pathStr}.${key}`));
    }
  }

  if (schema.type === 'array' && schema.items) {
    for (let i = 0; i < data.length; i++) {
      errors.push(...validate(schema.items, data[i], `${pathStr}[${i}]`));
    }
  }

  return errors;
}

module.exports = { validate };

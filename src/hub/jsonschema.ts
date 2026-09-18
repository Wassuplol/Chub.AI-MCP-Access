/***
 Converts an upstream tool's JSON Schema (as returned by MCP tools/list)
 into a zod shape usable with McpServer.registerTool.

 Covers the everyday subset (objects with typed properties, enums, arrays,
 required/optional, descriptions). Anything exotic (anyOf, $ref, pattern
 props...) makes us return null -- caller then falls back to a free-form
 args object so the tool still registers.
 ***/
import {z, ZodTypeAny} from "zod";

function describeIf(schema: any, t: ZodTypeAny): ZodTypeAny {
    const d = schema?.description ?? schema?.title;
    return typeof d === 'string' && d.length > 0 ? t.describe(d) : t;
}

function propToZod(schema: any, depth: number): ZodTypeAny {
    if (schema == null || typeof schema !== 'object' || depth > 6) return z.any();

    // enum (strings only corner; mixed enums fall back to a described string)
    if (Array.isArray(schema.enum) && schema.enum.length > 0) {
        if (schema.enum.every((v: any) => typeof v === 'string')) {
            try {
                return describeIf(schema, z.enum(schema.enum as [string, ...string[]]));
            } catch {
                return describeIf(schema, z.string());
            }
        }
        return describeIf(schema, z.any());
    }

    switch (schema.type) {
        case 'string':
            return describeIf(schema, z.string());
        case 'boolean':
            return describeIf(schema, z.boolean());
        case 'integer': {
            let t = z.number().int();
            if (typeof schema.minimum === 'number') t = t.min(schema.minimum);
            if (typeof schema.maximum === 'number') t = t.max(schema.maximum);
            return describeIf(schema, t);
        }
        case 'number': {
            let t = z.number();
            if (typeof schema.minimum === 'number') t = t.min(schema.minimum);
            if (typeof schema.maximum === 'number') t = t.max(schema.maximum);
            return describeIf(schema, t);
        }
        case 'array': {
            const item = schema.items ? propToZod(schema.items, depth + 1) : z.any();
            return describeIf(schema, z.array(item));
        }
        case 'object': {
            if (schema.properties && typeof schema.properties === 'object') {
                const shape = jsonSchemaToZodShape(schema, depth + 1);
                if (shape) return describeIf(schema, z.object(shape).passthrough());
            }
            return describeIf(schema, z.record(z.any()));
        }
        default: {
            // unions etc.: don't model precisely, accept anything
            if (Array.isArray(schema.type) && schema.type.length > 0) {
                // nullable single type, common pattern ["string","null"]
                const nonNull = schema.type.filter((t: any) => t !== 'null');
                if (nonNull.length === 1) {
                    return describeIf(schema, propToZod({...schema, type: nonNull[0]}, depth + 1).optional());
                }
            }
            return describeIf(schema, z.any());
        }
    }
}

/***
 Returns a ZodRawShape for the object schema, or null if the schema isn't a
 simple object (caller falls back to a generic args record).
 ***/
export function jsonSchemaToZodShape(schema: any, depth: number = 0): Record<string, ZodTypeAny> | null {
    if (schema == null) return {};
    if (typeof schema !== 'object' || schema.type !== 'object' ||
        schema.properties == null || typeof schema.properties !== 'object') {
        return null;
    }
    const required: string[] = Array.isArray(schema.required) ? schema.required : [];
    const shape: Record<string, ZodTypeAny> = {};
    for (const key of Object.keys(schema.properties)) {
        let t = propToZod(schema.properties[key], depth + 1);
        if (!required.includes(key)) t = t.optional();
        shape[key] = t;
    }
    return shape;
}

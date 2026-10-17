// Docs: docs/sdk-schema-plan.md. No runtime eval or external schema retrieval.
import { Validator } from "@cfworker/json-schema";
import { definitions, manifest } from "./contract.generated.js";
const validators = new Map();
export class ValidationError extends Error {
  constructor(model, paths) {
    super(`Invalid ${model}: ${paths.join(", ")}`);
    this.name = "ValidationError";
    this.model = model;
    this.paths = paths;
  }
}
export function validate(model, value) {
  if (!Object.hasOwn(definitions, model))
    throw new Error(`Unknown schema ${model}`);
  if (!validators.has(model))
    validators.set(
      model,
      new Validator(
        { $ref: `#/$defs/${model}`, $defs: definitions },
        "2020-12",
        false,
      ),
    );
  const result = validators.get(model).validate(value);
  if (!result.valid)
    throw new ValidationError(model, [
      ...new Set(result.errors.map((e) => e.instanceLocation || "/")),
    ]);
  return value;
}
export { manifest };

const { contractError } = require("./contractError");


function validateEventJson(event) {
  // ---- Basic existence ----
  if (!event) {
    throw contractError(
      "DATA",
      "INVALID_EVENT_JSON",
      "event.json is missing"
    );
  }

  if (typeof event !== "object") {
    throw contractError(
      "DATA",
      "INVALID_EVENT_JSON",
      "event.json must be an object"
    );
  }

  // ---- Components (your actual subEvents) ----
  if (!Array.isArray(event.components)) {
    throw contractError(
      "DATA",
      "INVALID_EVENT_JSON",
      "components must be an array"
    );
  }

  // ---- Validate each component ----
  for (const comp of event.components) {
    if (!comp || typeof comp !== "object") {
      throw contractError(
        "DATA",
        "INVALID_EVENT_JSON",
        "component must be an object",
        { component: comp }
      );
    }

    if (comp.id === undefined || comp.id === null) {
      throw contractError(
        "DATA",
        "MISSING_COMPONENT_ID",
        "Component missing id"
      );
    }

    if (!comp.folderName || typeof comp.folderName !== "string") {
      throw contractError(
        "DATA",
        "MISSING_FOLDERNAME",
        "component.folderName is required",
        { componentId: comp.id }
      );
    }
  }

  // ---- Optional groups (only validate if present) ----
  if (event.groups !== undefined && !Array.isArray(event.groups)) {
    throw contractError(
      "DATA",
      "INVALID_EVENT_JSON",
      "groups must be an array if present"
    );
  }

  // ---- (Optional future checks can go here) ----
  // e.g. duplicate component IDs, invalid naming, etc.

  return true;
}

module.exports = {
  validateEventJson
};